const path = require("path");
// prettier-ignore
const ABProcessTriggerCore = require(path.join(__dirname, "..", "..", "..", "core", "process", "tasks", "ABProcessTriggerCore.js"));

module.exports = class ABProcessTaskTrigger extends ABProcessTriggerCore {
   trigger(data, req) {
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
         .then(() => this.process.instanceNew(context, null, req))
         .catch((error) => {
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
