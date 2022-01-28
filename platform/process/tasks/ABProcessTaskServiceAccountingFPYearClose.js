const path = require("path");

// prettier-ignore
const AccountingFPYearCloseCore = require(path.join(__dirname, "..", "..", "..", "core", "process", "tasks", "ABProcessTaskServiceAccountingFPYearCloseCore.js"));

const AB = require("ab-utils");

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

      this.fpYearObject = this.AB.objectByID(this.objectFPYear);
      if (!this.fpYearObject) {
         this.log(instance, "Could not find FP Year object");
         return Promise.reject(new Error("Could not find FP Year object"));
      }

      this.fpMonthObject = this.AB.objectByID(this.objectFPMonth);
      if (!this.fpMonthObject) {
         this.log(instance, "Could not find FP Month object");
         return Promise.reject(new Error("Could not find FP Month object"));
      }

      this.glObject = this.AB.objectByID(this.objectGL);
      if (!this.glObject) {
         this.log(instance, "Could not find Balance object");
         return Promise.reject(new Error("Could not find Balance object"));
      }

      this.accObject = this.AB.objectByID(this.objectAccount);
      if (!this.accObject) {
         this.log(instance, "Could not find Account object");
         return Promise.reject(new Error("Could not find Account object"));
      }

      var myState = this.myState(instance);

      var currentProcessValues = this.hashProcessDataValues(instance);
      var currentFPYearID = currentProcessValues[this.processFPYearValue];
      if (!currentFPYearID) {
         this.log(instance, "unable to find relevant Fiscal Year ID");
         var error = new Error(
            "AccountingFPYearClose.do(): unable to find relevant Fiscal Year ID"
         );
         return Promise.reject(error);
      }

      return (
         Promise.resolve()
            // Pull FP Year object
            .then(
               () =>
                  new Promise((next, bad) => {
                     let cond = {
                        where: {
                           glue: "and",
                           rules: [
                              {
                                 key: this.fpYearObject.PK(),
                                 rule: "equals",
                                 value: currentFPYearID,
                              },
                           ],
                        },
                        populate: true,
                     };

                     this._req
                        .retry(() =>
                           this.fpYearObject.model().findAll(cond, null, req)
                        )
                        .then((rows) => {
                           this.currentFPYear = rows[0];

                           if (this.currentFPYear) {
                              this.log(instance, "Found FPYearObj");
                              next();
                           } else {
                              this.log(instance, "Not Found FPYearObj");
                              bad(new Error("Not Found FPYearObj"));
                           }
                        })
                        .catch((err) => {
                           this.log(instance, "Error finding FP Year Object");
                           this.onError(instance, err);
                           bad(err);
                        });
                  })
            )
            // 1. Find last fiscal month in fiscal year (M12)
            .then(
               () =>
                  new Promise((next, bad) => {
                     let fpMonthField = this.fpYearObject.fields(
                        (f) =>
                           f.key == "connectObject" &&
                           f.settings.linkObject == this.objectFPMonth
                     )[0];
                     if (!fpMonthField) {
                        this.log(instance, "Not Found fpMonthField");
                        return bad(new Error("Not Found fpMonthField"));
                     }

                     let fpMonthEndField = this.fpMonthObject.fieldByID(
                        this.fieldFPMonthEnd
                     );
                     if (!fpMonthEndField) {
                        this.log(instance, "Not Found fpMonthEndField");
                        return bad(new Error("Not Found fpMonthEndField"));
                     }

                     let FPmonths =
                        this.currentFPYear[fpMonthField.relationName()] || [];

                     if (!FPmonths[0]) {
                        this.log(instance, "Not Found the last FP month");
                        return bad(new Error("Not Found the last FP month"));
                     }

                     // Sort descending
                     FPmonths = FPmonths.sort(
                        (a, b) =>
                           b[fpMonthEndField.columnName] -
                           a[fpMonthEndField.columnName]
                     );

                     let cond = {
                        where: {
                           glue: "and",
                           rules: [
                              {
                                 key: this.fpMonthObject.PK(),
                                 rule: "equals",
                                 value: FPmonths[0][this.fpMonthObject.PK()],
                              },
                           ],
                        },
                        populate: true,
                     };

                     this._req
                        .retry(() =>
                           this.fpMonthObject.model().findAll(cond, null, req)
                        )
                        .then((rows) => {
                           this.lastFPMonth = rows[0];

                           if (this.lastFPMonth) {
                              this.log(instance, "Found the last FP Month");
                              next();
                           } else {
                              this.log(
                                 instance,
                                 "Not Found last FP Month with balances"
                              );
                              bad(
                                 new Error(
                                    "Not Found last FP Month with balances"
                                 )
                              );
                           }
                        })
                        .catch((err) => {
                           this.log(
                              instance,
                              "Error Finding last FP Month with balances"
                           );
                           this.onError(this._instance, err);
                           bad(err);
                        });
                  })
            )
            // 2. Find M12 Balances with Account Number = 3500 or 3991
            .then(
               () =>
                  new Promise((next, bad) => {
                     let accNumberField = this.accObject.fieldByID(
                        this.fieldAccNumber
                     );
                     if (!accNumberField) {
                        this.log(instance, "Not Found Account Number Field");
                        return bad(new Error("Not Found Account Number Field"));
                     }

                     let cond = {
                        where: {
                           glue: "or",
                           rules: [
                              {
                                 key: accNumberField.id,
                                 rule: "equals",
                                 value: this.valueFundBalances,
                              },
                              {
                                 key: accNumberField.id,
                                 rule: "equals",
                                 value: this.valueNetIncome,
                              },
                           ],
                        },
                        populate: false,
                     };

                     // find id of accounts with Account Number = 3500 or 3991
                     this._req
                        .retry(() =>
                           this.accObject.model().findAll(cond, null, req)
                        )
                        .then((rows) => {
                           // { AccuntNumber: AccountRow, ..., AccuntNumberN: AccountRowN }
                           this.accounts = {};
                           (rows || []).forEach(
                              (r) =>
                                 (this.accounts[r[accNumberField.columnName]] =
                                    r)
                           );

                           let fpBalanceField = this.fpMonthObject.fields(
                              (f) =>
                                 f.key == "connectObject" &&
                                 f.settings.linkObject == this.objectGL
                           )[0];
                           if (!fpBalanceField) {
                              this.log(instance, "Not Found fpBalanceField");
                              return bad(new Error("Not Found fpBalanceField"));
                           }
                           let balances =
                              this.lastFPMonth[fpBalanceField.relationName()] ||
                              [];

                           // filter balances by Account Number = 3500 or 3991
                           let glAccountField = this.glObject.fields(
                              (f) =>
                                 f.key == "connectObject" &&
                                 f.settings.linkObject == this.objectAccount
                           )[0];
                           if (!glAccountField) {
                              this.log(instance, "Not Found glAccountField");
                              return bad(new Error("Not Found glAccountField"));
                           }

                           this.balances = balances.filter((b) => {
                              // Filter by Account
                              let fkAccounts = Object.values(this.accounts).map(
                                 (acc) => glAccountField.getRelationValue(acc)
                              );

                              return (
                                 fkAccounts.indexOf(
                                    b[glAccountField.columnName]
                                 ) > -1
                              );
                           });

                           this.log(instance, "Found M12 Balances");

                           next();
                        })
                        .catch((err) => {
                           this.log(instance, "Error Finding M12 Balances");
                           this.onError(instance, err);
                           bad(err);
                        });
                  })
            )
            // 3. Find the next fiscal year
            .then(
               () =>
                  new Promise((next, bad) => {
                     let fpStartField = this.fpYearObject.fieldByID(
                        this.fieldFPYearStart
                     );
                     let fpEndField = this.fpYearObject.fieldByID(
                        this.fieldFPYearEnd
                     );

                     if (!fpStartField) {
                        this.log(instance, "Not Found FP Year Start Field");
                        return bad(new Error("Not Found FP Year Start Field"));
                     }
                     if (!fpEndField) {
                        this.log(instance, "Not Found FP Year End Field");
                        return bad(new Error("Not Found FP Year End Field"));
                     }

                     let endDate = this.currentFPYear[fpEndField.columnName];
                     if (!endDate) {
                        this.log(instance, "FP Year End date is empty");
                        return bad(new Error("FP Year End date is empty"));
                     }

                     if (!(endDate instanceof Date)) {
                        endDate = new Date(endDate);
                     } else {
                        endDate = _.clone(endDate);
                     }

                     // add 1 day
                     let startDate = endDate.setDate(endDate.getDate() + 1);

                     if (fpStartField.key == "date")
                        startDate = this.AB.rules.toSQLDate(startDate);

                     let cond = {
                        where: {
                           glue: "and",
                           rules: [
                              {
                                 key: fpStartField.id,
                                 rule: "equals",
                                 value: startDate,
                              },
                           ],
                        },
                        populate: true,
                     };

                     this._req
                        .retry(() =>
                           this.fpYearObject.model().findAll(cond, null, req)
                        )
                        .then((rows) => {
                           this.nextFpYear = rows[0];

                           if (!this.nextFpYear) {
                              this.log(instance, "Not Found Next FP Year");
                              return bad(new Error("Not Found Next FP Year"));
                           }

                           next();
                        })
                        .catch((err) => {
                           this.log(instance, "Error finding next FP year");
                           this.onError(this._instance, err);
                           bad(err);
                        });
                  })
            )
            // 3.1 set the next FP Year to Status = Active
            .then(
               () =>
                  new Promise((next, bad) => {
                     let fieldFPYearStatus = this.fpYearObject.fieldByID(
                        this.fieldFPYearStatus
                     );
                     if (!fieldFPYearStatus) {
                        this.log(instance, "Could not found FP status field");
                        return bad(
                           new Error("Could not found FP status field")
                        );
                     }

                     let values = {};
                     values[fieldFPYearStatus.columnName] =
                        this.fieldFPYearActive;

                     this._req
                        .retry(() =>
                           this.fpYearObject
                              .model()
                              .update(
                                 this.nextFpYear[this.fpYearObject.PK()],
                                 values,
                                 null,
                                 trx
                              )
                        )
                        .then((updatedNextFP) => {
                           // Broadcast the update
                           this._req.broadcast
                              .dcUpdate(this.fpYearObject.id, updatedNextFP)
                              .then(next)
                              .catch(bad);
                        })
                        .catch((err) => {
                           this.log(
                              this._instance,
                              "Error setting next FP Year Status = Active"
                           );
                           this.onError(this._instance, err);
                           bad(err);
                        });
                  })
            )
            // 4. Find first fiscal month in the next fiscal year (M1)
            .then(
               () =>
                  new Promise((next, bad) => {
                     let fpMonthField = this.fpYearObject.fields(
                        (f) =>
                           f.key == "connectObject" &&
                           f.settings.linkObject == this.objectFPMonth
                     )[0];

                     if (!fpMonthField) {
                        this.log(instance, "Could not found FP month field");
                        return bad(new Error("Could not found FP month field"));
                     }

                     let fpMonthStartField = this.fpMonthObject.fieldByID(
                        this.fieldFPMonthStart
                     );

                     if (!fpMonthStartField) {
                        this.log(
                           instance,
                           "Could not found FP month start field"
                        );
                        return bad(
                           new Error("Could not found FP month start field")
                        );
                     }

                     let fpMonths =
                        this.nextFpYear[fpMonthField.relationName()] || [];

                     // Sort ascending
                     fpMonths = fpMonths.sort(
                        (a, b) =>
                           a[fpMonthStartField.columnName] -
                           b[fpMonthStartField.columnName]
                     );
                     this.firstFpMonth = fpMonths[0];
                     if (!this.firstFpMonth) {
                        this.log(
                           instance,
                           "Could not found the first FP month data"
                        );
                        return bad(
                           new Error("Could not found the first FP month data")
                        );
                     }

                     next();
                  })
            )
            // 5. Find All M1 Balances With Account Type = Income, Expense, or Equity
            .then(
               () =>
                  new Promise((next, bad) => {
                     let glFPMonthField = this.glObject.fields(
                        (f) =>
                           f.key == "connectObject" &&
                           f.settings.linkObject == this.objectFPMonth
                     )[0];
                     if (!glFPMonthField) {
                        this.log(
                           instance,
                           "Could not found GL -> FP month field"
                        );
                        return bad(
                           new Error("Could not found GL -> FP month field")
                        );
                     }

                     let cond = {
                        where: {
                           glue: "and",
                           rules: [
                              {
                                 key: glFPMonthField.id,
                                 rule: "equals",
                                 value: glFPMonthField.getRelationValue(
                                    this.firstFpMonth
                                 ),
                              },
                           ],
                        },
                        populate: true,
                     };

                     this._req
                        .retry(() =>
                           this.glObject.model().findAll(cond, null, req)
                        )
                        .then((rows) => {
                           this.nextBalances = rows || [];

                           this.log(instance, "Found next M1 Balances");
                           next();
                        })
                        .catch((err) => {
                           this.log(instance, "Error finding M1 Balances");
                           this.onError(this._instance, err);
                           bad(err);
                        });
                  })
            )
            // 6. Update M1 Balances
            .then(
               () =>
                  new Promise((next, bad) => {
                     let glAccountField = this.glObject.fields(
                        (f) =>
                           f.key == "connectObject" &&
                           f.settings.linkObject == this.objectAccount
                     )[0];
                     if (!glAccountField) {
                        this.log(
                           instance,
                           "Could not found link GL to Acc field"
                        );
                        return bad(
                           new Error("Could not found link GL to Acc field")
                        );
                     }

                     let accNumberField = this.accObject.fieldByID(
                        this.fieldAccNumber
                     );
                     if (!accNumberField) {
                        this.log(
                           instance,
                           "Could not found link Acc Number field"
                        );
                        return bad(
                           new Error("Could not found link Acc Number field")
                        );
                     }

                     let accTypeField = this.accObject.fieldByID(
                        this.fieldAccType
                     );
                     if (!accTypeField) {
                        this.log(
                           instance,
                           "Could not found link Acc Type field"
                        );
                        return bad(
                           new Error("Could not found link Acc Type field")
                        );
                     }

                     let glStartField = this.glObject.fieldByID(
                        this.fieldGLStartBalance
                     );
                     if (!glStartField) {
                        this.log(
                           instance,
                           "Could not found GL start balance field"
                        );
                        return bad(
                           new Error("Could not found GL start balance field")
                        );
                     }

                     let glRunningField = this.glObject.fieldByID(
                        this.fieldGLRunningBalance
                     );
                     if (!glRunningField) {
                        this.log(
                           instance,
                           "Could not found GL running balance field"
                        );
                        return bad(
                           new Error("Could not found GL running balance field")
                        );
                     }

                     let glRcField = this.glObject.fieldByID(this.fieldGLrc);
                     if (!glRcField) {
                        this.log(instance, "Could not found GL RC field");
                        return bad(new Error("Could not found GL RC field"));
                     }

                     let tasks = [];

                     this.nextBalances.forEach((b) => {
                        let accInfo = b[glAccountField.relationName()];
                        if (!accInfo) return;

                        let values = null;

                        // If Account Type is Income or Expense or Equity, or Account is 3991:
                        // Set Starting Balance and Running Balance to 0
                        if (
                           accInfo[accTypeField.columnName] ==
                              this.fieldAccTypeIncome ||
                           accInfo[accTypeField.columnName] ==
                              this.fieldAccTypeExpense ||
                           accInfo[accNumberField.columnName] ==
                              this.valueNetIncome
                        ) {
                           values = values || {};
                           values[glStartField.columnName] = 0;
                           values[glRunningField.columnName] = 0;
                        }
                        // If Account is 3500
                        // Set Starting Balance and Running Balance equal to M12-3500 Running Balance + M12-3991 Running Balance (with matching RCs)
                        else if (
                           accInfo[accNumberField.columnName] ==
                           this.valueFundBalances
                        ) {
                           let b3500 =
                              this.balances.filter(
                                 (bal) =>
                                    bal[glAccountField.columnName] ==
                                       glAccountField.getRelationValue(
                                          this.accounts[this.valueFundBalances]
                                       ) &&
                                    bal[glRcField.columnName] ==
                                       b[glRcField.columnName]
                              )[0] || {};

                           let b3991 =
                              this.balances.filter(
                                 (bal) =>
                                    bal[glAccountField.columnName] ==
                                       glAccountField.getRelationValue(
                                          this.accounts[this.valueNetIncome]
                                       ) &&
                                    bal[glRcField.columnName] ==
                                       b[glRcField.columnName]
                              )[0] || {};

                           let numBalance =
                              (b3500[glRunningField.columnName] || 0) +
                              (b3991[glRunningField.columnName] || 0);

                           // this.log(instance, b[this.glObject.PK()]);
                           // this.log(instance, numBalance);
                           // this.log(instance, b3500[this.glObject.PK()]);
                           // this.log(instance, b3991[this.glObject.PK()]);
                           // this.log(instance, JSON.stringify(values));

                           values = values || {};
                           values[glStartField.columnName] = numBalance;
                           values[glRunningField.columnName] = numBalance;
                        }

                        if (values) {
                           tasks.push(
                              new Promise((go, fail) => {
                                 this._req
                                    .retry(() =>
                                       this.glObject
                                          .model()
                                          .update(
                                             b[this.glObject.PK()],
                                             values,
                                             null,
                                             trx
                                          )
                                    )
                                    .then((updatedGL) => {
                                       // Broadcast the update
                                       this._req.broadcast
                                          .dcUpdate(this.glObject.id, updatedGL)
                                          .then(go)
                                          .catch(fail);
                                    })
                                    .catch((err) => {
                                       this.onError(this._instance, err);
                                       fail(err);
                                    });
                              })
                           );
                        }
                     });

                     Promise.all(tasks)
                        .then(() => next())
                        .catch((err) => {
                           this.log(
                              instance,
                              "Error Updating GL Object Values"
                           );
                           this.onError(instance, err);
                           bad(err);
                        });
                  })
            )
            // Final step
            .then(() => {
               this.log(instance, "I'm done.");
               this.stateCompleted(instance);
               return true;
            })
            .catch((err) => {
               this.log(instance, "Error FPYearClose");
               this.onError(instance, err);
               throw err;
            })
      );
   }
};
