const path = require("path");
// prettier-ignore
const ABProcessTriggerCore = require(path.join(__dirname, "..", "..", "..", "core", "process", "tasks", "ABProcessTriggerCore.js"));

module.exports = class ABProcessTaskTrigger extends ABProcessTriggerCore {
   trigger(data, req, instanceKey) {
      // call my process.newInstance with
      if (!this.process) {
         var error = new Error("ABProcessTaskTrigger with a missing process?");
         this.AB.notify.builder(error, { task: this });
         return Promise.resolve();
      }
      var context = this.process.context(data);
      this.initState(context, { triggered: true, status: "completed", data });
      context.startTaskID = this.diagramID;

      return Promise.resolve()
         .then(() => this.process.instanceNew(context, null, req, instanceKey))
         .catch((error) => {
            if (error.nativeError.code == "ER_DUP_ENTRY") {
               // This means the instanceKey already exisits in the database,
               // which can happen if the first request times out. We want
               // to report this as a success, so the retries stop.
               req.log(`Process already triggered for ${instanceKey}`);
               return;
            }
            this.AB.notify.developer(error, {
               context: `ABProcessTrigger.trigger()`,
               task: this,
            });

            this.AB.error(error);
            // propogate the error
            throw error;
         });
   }
};
