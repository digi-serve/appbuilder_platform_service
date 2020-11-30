const path = require("path");
// prettier-ignore
const ABProcessTriggerCore = require(path.join(__dirname, "..", "..", "..", "core", "process", "tasks", "ABProcessTriggerCore.js"));

module.exports = class ABProcessTaskTrigger extends ABProcessTriggerCore {
   trigger(data) {
      // call my process.newInstance with
      if (!this.process) {
         return Promise.resolve();
      }
      var context = this.process.context(data);
      this.initState(context, { triggered: true, status: "completed", data });
      context.startTaskID = this.diagramID;

      let dbTransaction;

      return (
         Promise.resolve()
            // Create Knex.transactions
            .then(
               () =>
                  new Promise((next /* , bad */) => {
                     this.AB.Knex.createTransaction((trx) => {
                        dbTransaction = trx;
                        next();
                     });
                  })
            )
            // modify data in any appropriate way then:
            .then(() => this.process.instanceNew(context, dbTransaction))
            // save changes to DB
            .then(() => {
               dbTransaction.commit();
            })
            // cancel changes
            .catch((error) => {
               dbTransaction.rollback();
               this.AB.error(error);
               // throw error;
            })
      );
   }
};
