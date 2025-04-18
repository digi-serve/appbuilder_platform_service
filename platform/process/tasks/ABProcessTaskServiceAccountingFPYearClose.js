const path = require("path");

// prettier-ignore
const AccountingFPYearCloseCore = require(path.join(__dirname, "..", "..", "..", "core", "process", "tasks", "ABProcessTaskServiceAccountingFPYearCloseCore.js"));

module.exports = class AccountingFPYearClose extends AccountingFPYearCloseCore {
   ////
   //// Process Instance Methods
   ////

   /**
    * do()
    * this method actually performs the action for this task.
    * @param {obj} instance  the instance data of the running process
    * @param {Knex.Transaction?} trx - [optional]
    * @param {ABUtil.reqService} req
    *        an instance of the current request object for performing tenant
    *        based operations.
    * @return {Promise}
    *      resolve(true/false) : true if the task is completed.
    *                            false if task is still waiting
    */
   do(instance, trx, req) {
      this._req = req;
      this._dbTransaction = trx;
      this._instance = instance;

      return new Promise((resolve, reject) => {
         var currentProcessValues = this.hashProcessDataValues(instance);
         var currentFPYearID = currentProcessValues[this.processFPYearValue];
         if (!currentFPYearID) {
            this.log(instance, "unable to find relevant Fiscal Year ID");
            var error = new Error(
               "AccountingFPYearClose.do(): unable to find relevant Fiscal Year ID",
            );
            return Promise.reject(error);
         }
         Promise.resolve()
            //
            .then(() => {
               const knex = this.AB.Knex.connection();
               return this._req.retry(() =>
                  knex.raw(
                     `CALL \`CLOSE_FY_YEAR_PROCESS\`("${currentFPYearID}");`,
                  ),
               );
            })
            // Final step
            .then(() => {
               this.log(instance, "I'm done.");
               this.stateCompleted(instance);
               resolve(true);
            })
            .catch((err) => {
               this.log(instance, "Error FPYearClose");
               this.onError(instance, err);
               reject(err);
            });
      });
   }
};
