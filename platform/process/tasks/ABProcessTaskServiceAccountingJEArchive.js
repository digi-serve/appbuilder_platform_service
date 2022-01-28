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
   do(instance, trx, req) {
      this._dbTransaction = trx;
      this._req = req;

      this.batchObject = this.AB.objectByID(this.objectBatch);
      if (!this.batchObject) {
         return this.errorConfig(
            instance,
            "Could not find Batch object",
            "objectBatch"
         );
      }

      this.batchFiscalMonthField = this.batchObject.fieldByID(
         this.fieldBatchFiscalMonth
      );
      if (!this.batchFiscalMonthField) {
         return this.errorConfig(
            instance,
            "Could not find Batch->Fiscal Month field",
            "fieldBatchFiscalMonth"
         );
      }

      this.balanceObject = this.AB.objectByID(this.objectBalance);
      if (!this.balanceObject) {
         return this.errorConfig(
            instance,
            "Could not found Balance object",
            "objectBalance"
         );
      }

      this.balanceAccountField = this.balanceObject.fieldByID(
         this.fieldBrAccount
      );
      if (!this.balanceAccountField) {
         return this.errorConfig(
            instance,
            "Could not found Batch->Account field",
            "fieldBrAccount"
         );
      }

      this.balanceRcField = this.balanceObject.fieldByID(this.fieldBrRC);
      if (!this.balanceRcField) {
         return this.errorConfig(
            instance,
            "Could not found Batch->RC field",
            "fieldBrRC"
         );
      }

      this.jeObject = this.AB.objectByID(this.objectJE);
      if (!this.jeObject) {
         return this.errorConfig(
            instance,
            "Could not found JE object",
            "objectJE"
         );
      }

      this.jeArchiveObject = this.AB.objectByID(this.objectJEArchive);
      if (!this.jeArchiveObject) {
         return this.errorConfig(
            instance,
            "Could not found JE Archive object",
            "objectJEArchive"
         );
      }

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

      this.jeAccountField = this.jeObject.fieldByID(this.fieldJeAccount);
      if (!this.jeAccountField) {
         return this.errorConfig(
            instance,
            "Could not found the connect JE to Account field",
            "fieldJeAccount"
         );
      }

      this.jeRcField = this.jeObject.fieldByID(this.fieldJeRC);
      if (!this.jeRcField) {
         return this.errorConfig(
            instance,
            "Could not found the connect JE to RC field",
            "fieldJeRC"
         );
      }

      this.jeArchiveBalanceField = this.jeArchiveObject.fieldByID(
         this.fieldJeArchiveBalance
      );
      if (!this.jeArchiveBalanceField) {
         return this.errorConfig(
            instance,
            "Could not found the connect JE Archive to BR field",
            "fieldJeArchiveBalance"
         );
      }

      var currentProcessValues = this.hashProcessDataValues(instance);
      var currentBatchID = currentProcessValues[this.processBatchValue];
      if (!currentBatchID) {
         return this.errorConfig(
            instance,
            "AccountingJEArchive.do(): unable to find relevant Batch ID",
            "processBatchValue"
         );
      }

      return (
         Promise.resolve()
            // Pull Batch
            .then(
               () =>
                  new Promise((next, bad) => {
                     this._req
                        .retry(() =>
                           this.batchObject.model().findAll(
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
                           )
                        )
                        .then((batch) => {
                           this.batch = batch[0];

                           if (!this.batch) {
                              this.log(instance, "Could not find Batch");
                              var error = new Error("Could not find Batch");
                              return bad(error);
                           }
                           next();
                        })
                        .catch((err) => {
                           this.log(
                              instance,
                              `Error looking up Batch [${currentBatchID}]`
                           );
                           this.onError(this._instance, err);
                           bad(err);
                        });
                  })
            )
            // Pull JE data
            .then(
               () =>
                  new Promise((next, bad) => {
                     // get custom index value to search
                     let batchIndexVal = currentBatchID;
                     if (this.jeBatchField.indexField) {
                        batchIndexVal =
                           this.batch[this.jeBatchField.indexField.columnName];
                     }

                     let cond = {
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
                     };

                     this._req
                        .retry(() =>
                           this.jeObject.model().findAll(cond, null, req)
                        )
                        .then((journals) => {
                           this.journals = journals || [];
                           next();
                        })
                        .catch((err) => {
                           this.onError(this._instance, err);
                           bad(err);
                        });
                  })
            )
            // Pull Balances
            .then(
               () =>
                  new Promise((next, bad) => {
                     this.balances = [];

                     if (!this.journals || !this.journals.length) return next();

                     let fiscalMonthId =
                        this.batch[this.batchFiscalMonthField.columnName];

                     let tasks = [];

                     (this.journals || []).forEach((je) => {
                        if (
                           !je ||
                           !je[this.jeAccountField.columnName] ||
                           !je[this.jeRcField.columnName]
                        )
                           return;

                        let cond = {
                           where: {
                              glue: "and",
                              rules: [
                                 {
                                    key: this.fieldBrFiscalMonth,
                                    rule: "equals",
                                    value: fiscalMonthId,
                                 },
                                 {
                                    key: this.fieldBrAccount,
                                    rule: "equals",
                                    value: je[this.jeAccountField.columnName],
                                 },
                                 {
                                    key: this.fieldBrRC,
                                    rule: "equals",
                                    value: je[this.jeRcField.columnName],
                                 },
                              ],
                           },
                           populate: false,
                        };

                        tasks.push(
                           new Promise((ok, no) => {
                              this._req
                                 .retry(() =>
                                    this.balanceObject
                                       .model()
                                       .findAll(cond, null, req)
                                 )
                                 .then((balances) => {
                                    this.balances = this.balances.concat(
                                       balances || []
                                    );
                                    ok();
                                 })
                                 .catch((err) => {
                                    ok();
                                 });
                           })
                        );
                     });

                     Promise.all(tasks)
                        .then(() => next())
                        .catch(bad);
                  })
            )
            // Copy JE to JE Archive
            .then(
               () =>
                  new Promise((next, bad) => {
                     let tasks = [];

                     (this.journals || []).forEach((je) => {
                        let jeArchiveValues = {};

                        // link to Balance
                        let balance = (this.balances || []).filter(
                           (b) =>
                              b[this.balanceAccountField.columnName] ==
                                 je[this.jeAccountField.columnName] &&
                              b[this.balanceRcField.columnName] ==
                                 je[this.jeRcField.columnName]
                        )[0];
                        if (balance) {
                           let customBrIndex = "uuid";

                           if (this.jeArchiveBalanceField.indexField) {
                              customBrIndex =
                                 this.jeArchiveBalanceField.indexField
                                    .columnName;
                           }

                           jeArchiveValues[
                              this.jeArchiveBalanceField.columnName
                           ] = balance[customBrIndex];
                        }

                        let findArcRules = [];
                        Object.keys(this.fieldsMatch).forEach((fId) => {
                           let fJe = this.jeObject.fields(
                              (f) => f.id == this.fieldsMatch[fId]
                           )[0];
                           if (fJe == null) return;

                           let fArc = this.jeArchiveObject.fields(
                              (f) => f.id == fId
                           )[0];
                           if (fArc == null) return;

                           // Connect field
                           if (fJe.key == "connectObject") {
                              jeArchiveValues[fArc.columnName] =
                                 je[fJe.columnName];

                              jeArchiveValues[fArc.relationName()] =
                                 je[fJe.relationName()];
                           }
                           // Other field
                           else if (je[fJe.columnName] != null) {
                              jeArchiveValues[fArc.columnName] =
                                 je[fJe.columnName];
                           }

                           // Add filter rule
                           findArcRules.push({
                              key: fArc.id,
                              rule: "equals",
                              value: je[fJe.columnName],
                           });
                        });

                        if (Object.keys(jeArchiveValues).length > 1) {
                           // call .requestParams to set default values and reformat value properly
                           jeArchiveValues =
                              this.jeArchiveObject.requestParams(
                                 jeArchiveValues
                              );

                           // check exists JE Archive
                           tasks.push(
                              () =>
                                 new Promise((ok, no) => {
                                    this._req
                                       .retry(() =>
                                          this.jeArchiveObject.model().findAll(
                                             {
                                                where: {
                                                   glue: "and",
                                                   rules: findArcRules,
                                                },
                                                populate: false,
                                             },
                                             null,
                                             this._req
                                          )
                                       )
                                       .then((jeArchives) => {
                                          let exists =
                                             jeArchives &&
                                             jeArchives.length > 0;
                                          ok(exists);
                                       })
                                       .catch((err) => {
                                          this.log(
                                             this._instance,
                                             "Error checking for existing JE Archive"
                                          );
                                          this.onError(this._instance, err);
                                          no(err);
                                       });
                                 })
                           );

                           tasks.push(
                              (isExists) =>
                                 new Promise((ok, no) => {
                                    if (isExists) {
                                       ok();
                                       return;
                                    }

                                    this.log(
                                       instance,
                                       "Creating JE Archive ..."
                                    );
                                    this.log(
                                       instance,
                                       JSON.stringify(jeArchiveValues)
                                    );

                                    var isError = false;
                                    this._req
                                       .retry(
                                          () =>
                                             this.jeArchiveObject
                                                .model()
                                                // .create(jeArchiveValues, trx)
                                                .create(jeArchiveValues) // NOTE: Ignore MySQL transaction because client needs id of entry.
                                       )
                                       .catch((err) => {
                                          if (
                                             err
                                                .toString()
                                                .indexOf(
                                                   "ER_SIGNAL_EXCEPTION"
                                                ) > -1
                                          ) {
                                             return;
                                          }
                                          isError = true;
                                          this.onError(this._instance, err);
                                          no(err);
                                       })
                                       .then((newJeArchive) => {
                                          if (isError) return;

                                          // Broadcast
                                          this._req.broadcast.dcCreate(
                                             this.jeArchiveObject.id,
                                             newJeArchive
                                          );

                                          ok();
                                       });
                                 })
                           );
                        }
                     });

                     // Promise.all(tasks)
                     //    .catch(bad)
                     //    .then(() => next());

                     tasks.push(() => next());

                     // create JE archive sequentially
                     tasks
                        .reduce((promiseChain, currTask) => {
                           return promiseChain.then(currTask);
                        }, Promise.resolve([]))
                        .catch((err) => {
                           this.onError(this._instance, err);
                           bad(err);
                        });
                  })
            )
            // Remove JEs
            .then(
               () =>
                  new Promise((next, bad) => {
                     if (!this.balances || !this.balances.length) return next();

                     let jeIds = (this.journals || []).map((je) => je.uuid);
                     if (!jeIds || !jeIds.length) return next();

                     this.log(instance, "Deleting JE ...");
                     this.log(instance, JSON.stringify(jeIds));

                     this._req
                        .retry(() =>
                           this.jeObject
                              .model()
                              .modelKnex()
                              .query(trx)
                              .delete()
                              .where("uuid", "IN", jeIds)
                        )
                        .then(() => {
                           // Broadcast
                           (jeIds || []).forEach((jeId) => {
                              this._req.broadcast.dcDelete(
                                 this.jeObject.id,
                                 jeId
                              );
                           });

                           next();
                        })
                        .catch((err) => {
                           this.log(
                              this._instance,
                              "Error deleting JE Objects"
                           );
                           this.onError(this._instance, err);
                           bad(err);
                        });
                  })
            )
            // finish out the Process Task
            .then(() => {
               this.stateCompleted(instance);
               this.log(instance, "JE Archive process successfully");
               return true;
            })
            .catch((err) => {
               this.log(
                  this._instance,
                  "JE Archive process exiting due to error:"
               );
               this.onError(this._instance, err);
               throw err;
            })
      );
   }
};
