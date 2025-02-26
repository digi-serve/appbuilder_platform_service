/*
 * ABQLRowUpdate
 *
 * An ABQLRow Update allows you to update the values on the current
 * Row of data.
 *
 */

const ABQLRowUpdateCore = require("../../core/ql/ABQLRowUpdateCore.js");
const _ = require("lodash");

class ABQLRowUpdate extends ABQLRowUpdateCore {
   ///
   /// Instance Methods
   ///

   /**
    * do()
    * perform the action for this Query Language Operation.
    * @param {Promise} chain
    *        The incoming Promise that we need to extend and use to perform
    *        our action.
    * @param {obj} instance
    *        The current process instance values used by our tasks to store
    *        their state/values.
    * @param {Knex.Transaction?} trx
    *        (optional) Knex Transaction instance.
    * @param {ABUtil.reqService} req
    *        an instance of the current request object for performing tenant
    *        based operations.
    * @return {Promise}
    */
   do(chain, instance, trx, req) {
      if (!chain) {
         throw new Error("ABQLRowUpdate.do() called without a Promise chain!");
      }

      // capture the new promise from the .then() and
      // return that as the next link in the chain
      var nextLink = chain.then((context) => {
         var nextContext = {
            label: "ABQLRowUpdate",
            object: context.object,
            data: null,
            prev: context,
         };

         if (!context.object || context.data == null) {
            // weird!  pass along our context with data == null;

            if (!context.data) {
               var current = context;
               console.error("no data provided to ABQLRowUpdate:", current);
               while (current.prev) {
                  current = current.prev;
                  console.error("prev:", current);
               }
            }

            return nextContext;
         }

         // otherwise, we perform our .update(), save the results to our
         // nextContext and then continue on:
         return new Promise((resolve, reject) => {
            // if there are no values to update then just continue.
            if (
               !this.params ||
               !this.params.values ||
               this.params.values.length < 1
            ) {
               resolve(nextContext);
               return;
            }

            // figure out the update values:
            var updateParams = {};
            for (var v = 0; v < this.params.values.length; v++) {
               var value = this.params.values[v];
               var field = context.object.fieldByID(value.fieldId);
               if (!field) {
                  var missingFieldError = new Error(
                     `ABQLRowUpdate could not find field[${value.fieldId}] in provided object[${context.object.id}]`
                  );
                  reject(missingFieldError);
                  return;
               }

               // Set value from process data
               if (value && value.isProcessValue) {
                  // get process field
                  let processField = (
                     this.task.process.processDataFields(this.task) || []
                  ).filter(
                     (opt) =>
                        opt &&
                        (opt.key == value.value ||
                           opt.value == value.value ||
                           opt.label == value.value)
                  )[0];

                  // pull/set the process value
                  if (processField) {
                     updateParams[field.columnName] =
                        this.task.process.processData(this.task, [
                           instance,
                           processField.key,
                        ]);
                  }
               }
               // Set custom value
               else {
                  updateParams[field.columnName] = value.value ?? null;
               }
            }

            // call .requestParams to set default values and reformat value properly
            var updateParams = _.merge(
               context.object.requestParams(updateParams),
               context.object.requestRelationParams(updateParams)
            );

            // Perform the update.

            // NOTE: if we implement the Knex Transactions, then we will have to
            // Refactor this so that we play well with transactions.
            //
            // req.retry(() =>
            //    context.object.model().update(id, updateParams, null, trx)
            // )
            //    .then((updatedRow) => {
            //       // this returns the fully populated & updated row
            //       nextContext.data = updatedRow;
            //       resolve(nextContext);
            //    })
            //    .catch(reject);

            // Find the ID of the current .data row
            const PK = context.object.PK();
            const contentData = context.data;
            const ids = (Array.isArray(contentData) &&
               contentData.map((e) => e[PK])) || [contentData[PK]];

            // Calling the service to perform the update will implement all the
            // additional Process Lifecycle actions of the update:
            const limit = 10;
            const jobData = {
               objectID: context.object.id,
               values: updateParams,
               fromProcessManager: true,
            };
            const data = (nextContext.data = []);
            let pending = Promise.resolve();
            while (ids.length > 0) {
               const newPendings = ids.splice(0, limit).map(
                  (id) =>
                     new Promise((resolve, reject) => {
                        jobData.ID = id;
                        req.serviceRequest(
                           "appbuilder.model-update",
                           jobData,
                           (err, updatedRow) => {
                              if (err) {
                                 return reject(err);
                              }
                              // this returns the fully populated & updated row
                              data.push(updatedRow);
                              resolve();
                           }
                        );
                     })
               );
               pending = pending.then(() => Promise.all(newPendings));
            }
            pending.then(() => resolve(nextContext)).catch(reject);
         });
      });

      if (this.next) {
         return this.next.do(nextLink, instance, trx, req);
      } else {
         return nextLink;
      }
   }
}

module.exports = ABQLRowUpdate;
