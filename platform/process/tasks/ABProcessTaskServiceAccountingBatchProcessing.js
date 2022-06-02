const path = require("path");
// prettier-ignore
const AccountingBatchProcessingCore = require(path.join(__dirname, "..", "..", "..", "core", "process", "tasks", "ABProcessTaskServiceAccountingBatchProcessingCore.js"));

// const async = require("async");
// const uuid = require("uuid/v4");

module.exports = class AccountingBatchProcessing extends (
   AccountingBatchProcessingCore
) {
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
   async do(instance, trx, req) {
      this._dbTransaction = trx;
      this._req = req;
      this._instance = instance;

      // Setup references to the ABObject and Fields that we will use in our
      // operations.
      this.batchObj = this.AB.objectByID(this.objectBatch);
      this.brObject = this.AB.objectByID(this.objectBR);
      this.jeObject = this.AB.objectByID(this.objectJE);

      if (!this.batchObj) {
         return this.errorConfig(
            instance,
            `AccountBatchProcessing.do(): unable to find relevant Batch Object from our .objectBatch[${this.objectBatch}] configuration`,
            "objectBatch"
         );
      }

      if (!this.brObject) {
         return this.errorConfig(
            instance,
            `AccountBatchProcessing.do(): unable to find relevant Balance Object from our .objectBR[${this.objectBR}] configuration`,
            "objectBR"
         );
      }

      if (!this.jeObject) {
         return this.errorConfig(
            instance,
            `AccountBatchProcessing.do(): unable to find relevant Journal Entry Object from our .objectJE[${this.objectJE}] configuration`,
            "objectJE"
         );
      }

      // Fields
      this.batchFinancialPeriodField = this.batchObj.fieldByID(
         this.fieldBatchFinancialPeriod
      );
      this.batchEntriesField = this.batchObj.fieldByID(this.fieldBatchEntries);
      this.brFinancialPeriodField = this.brObject.fieldByID(
         this.fieldBRFinancialPeriod
      );
      this.brAccountField = this.brObject.fieldByID(this.fieldBRAccount);
      this.jeAccountField = this.jeObject.fieldByID(this.fieldJEAccount);

      // get the current Batch Data from the process
      const currentProcessValues = this.hashProcessDataValues(instance);
      const currentBatchID = currentProcessValues[this.processBatchValue];
      if (!currentBatchID) {
         return this.errorConfig(
            instance,
            `AccountBatchProcessing.do(): unable to find relevant Batch ID .processBatchValue[${this.processBatchValue}]`,
            "processBatchValue"
         );
      }

      // Pull Batch entry
      const batchEntries = await this.batchObj.model().findAll(
         {
            where: {
               glue: "and",
               rules: [
                  {
                     key: this.batchObj.PK(),
                     rule: "equals",
                     value: currentBatchID,
                  },
               ],
            },
            populate: true,
         },
         null,
         req
      );

      if (!batchEntries || batchEntries.length < 1) {
         return this.errorConfig(
            instance,
            `AccountBatchProcessing.do(): unable to find Batch data for batchID[${currentBatchID}]`,
            "currentBatchID"
         );
      }

      this.batchEntry = batchEntries[0];

      // Run Process
      const knex = this.AB.Knex.connection();
      await this._req.retry(() =>
         knex.raw(`CALL \`BALANCE_PROCESS\`("${currentBatchID}");`)
      );

      // Broadcast
      let financialPeriod = this.batchEntry[
         this.batchFinancialPeriodField.columnName
      ];
      let journalEntries =
         this.batchEntry[this.batchEntriesField.relationName()] || [];
      let accountIDs = this.AB.uniq(
         journalEntries
            .map((je) => je[this.jeAccountField.columnName])
            .filter((accId) => accId)
      );

      let balCond = { glue: "and", rules: [] };
      balCond.rules.push({
         key: this.brFinancialPeriodField.id,
         rule: "equals",
         value: financialPeriod,
      });
      balCond.rules.push({
         key: this.brAccountField.id,
         rule: "in",
         value: accountIDs,
      });

      const balances = await this.brObject.model().findAll(
         {
            where: balCond,
            populate: true,
         },
         null,
         req
      );

      (balances || []).forEach((brItem) => {
         this._req.broadcast.dcUpdate(this.brObject.id, brItem);
      });

      // finish out the Process Task:
      this.stateCompleted(instance);
      this.log(instance, "Batch Processed successfully");
      return Promise.resolve(true);
   }
};
