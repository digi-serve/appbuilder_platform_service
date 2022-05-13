const path = require("path");
// prettier-ignore
const AccountingJEArchiveCore = require(path.join(__dirname, "..", "..", "..", "core", "process", "tasks", "ABProcessTaskServiceAccountingJEArchiveCore.js"));

module.exports = class AccountingFPYearClose extends AccountingJEArchiveCore {
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

      // Objects
      this.batchObject = this.AB.objectByID(this.objectBatch);
      this.jeObject = this.AB.objectByID(this.objectJE);
      this.jeArchiveObject = this.AB.objectByID(this.objectJEArchive);

      if (!this.batchObject) {
         return this.errorConfig(
            instance,
            `Could not find Batch object [${this.objectBatch}]`,
            "objectBatch"
         );
      }

      if (!this.jeObject) {
         return this.errorConfig(
            instance,
            `Could not found JE object [${this.objectJE}]`,
            "objectJE"
         );
      }

      if (!this.jeArchiveObject) {
         return this.errorConfig(
            instance,
            `Could not found JE Archive object [${this.objectJEArchive}]`,
            "objectJEArchive"
         );
      }

      // Fields
      this.jeBatchField = this.jeObject.fields(
         (f) =>
            f &&
            f.key == "connectObject" &&
            f.settings.linkObject == this.objectBatch
      )[0];
      if (!this.jeBatchField) {
         return this.errorConfig(
            instance,
            "Could not found the connect JE to Batch field",
            "objectBatch"
         );
      }

      let currentProcessValues = this.hashProcessDataValues(instance);
      let currentBatchID = currentProcessValues[this.processBatchValue];
      if (!currentBatchID) {
         return this.errorConfig(
            instance,
            `AccountingJEArchive.do(): unable to find relevant Batch ID [${this.processBatchValue}]`,
            "processBatchValue"
         );
      }

      // Pull Batch
      const batchEntries = await this.batchObject.model().findAll(
         {
            where: {
               glue: "and",
               rules: [
                  {
                     key: this.batchObject.PK(),
                     rule: "equals",
                     value: currentBatchID,
                  },
               ],
            },
            populate: false,
         },
         null,
         req
      );

      if (!batchEntries || batchEntries.length < 1) {
         return this.errorConfig(
            instance,
            `AccountingJEArchive.do(): unable to find Batch data for batchID[${currentBatchID}]`,
            "currentBatchID"
         );
      }

      this.batchEntry = batchEntries[0];

      // get custom index value to search
      let batchIndexVal = currentBatchID;
      if (this.jeBatchField.indexField) {
         batchIndexVal =
            this.batchEntry[this.jeBatchField.indexField.columnName];
      }

      // Pull JE data
      this.journals = await this.jeObject.model().findAll(
         {
            where: {
               glue: "and",
               rules: [
                  {
                     key: this.jeBatchField.id,
                     rule: "equals",
                     value: batchIndexVal,
                  },
               ],
            },
            populate: true,
         },
         null,
         req
      );

      // Run Process
      const knex = this.AB.Knex.connection();
      const result = await this._req.retry(() =>
         knex.raw(`CALL \`JEARCHIVE_PROCESS\`("${currentBatchID}");`)
      );
      const responseVals = result[0];
      const resultVals = responseVals[0];

      this.newJEArchIds = this.AB.uniq(
         resultVals
            .map((item) => item[this.jeArchiveObject.PK()])
            .filter((id)=> id)
      );

      // Pull JE Archives
      this.jeArchives = await this.jeArchiveObject.model().findAll(
         {
            where: {
               glue: "and",
               rules: [
                  {
                     key: this.jeArchiveObject.PK(),
                     rule: "in",
                     value: this.newJEArchIds,
                  },
               ],
            },
            populate: true,
         },
         null,
         req
      );

      // Broadcast
      (this.journals || []).forEach((je) => {
         this._req.broadcast.dcDelete(this.jeObject.id, je.uuid || je.id);
      });

      (this.jeArchives || []).forEach((jeArch) => {
         this._req.broadcast.dcCreate(this.jeArchiveObject.id, jeArch);
      });

      // Final
      this.stateCompleted(instance);
      this.log(instance, "JE Archive process successfully");
      return true;
   }
};
