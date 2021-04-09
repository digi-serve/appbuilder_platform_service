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

      let dbTransaction;

      return (
         Promise.resolve()
            .then(
               () =>
                  new Promise((next, bad) => {
                     this.AB.Knex.createTransaction((trx) => {
                        dbTransaction = trx;
                        next();
                     }).catch(bad);
                  })
            )
            // modify data in any appropriate way then:
            .then(() => this.process.instanceNew(context, dbTransaction, req))
            // save changes to DB
            .then(() => {
               dbTransaction.commit();
            })
            // cancel changes
            .catch((error) => {
               this.AB.notify.developer(error, {
                  context: `ABProcessTrigger.trigger()`,
                  task: this,
               });
               if (dbTransaction) dbTransaction.rollback();
               this.AB.error(error);
               // propogate the error
               throw error;
            })
      );
   }
};
