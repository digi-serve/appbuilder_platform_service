const ABQLRowPluckCore = require("../../core/ql/ABQLRowPluckCore.js");
const ABQLSetPluck = require("./ABQLSetPluck.js");

class ABQLRowPluck extends ABQLRowPluckCore {
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
      let nextLink = chain.then((context) => {
         return (
            Promise.resolve()
               // Reuse a pluck data function from ABQLSetPluck
               .then(() => {
                  let prepareChain = new Promise((next) => {
                     let prepareContext = {
                        object: context.object,
                        data: context.data,
                        prev: context,
                     };

                     // convert to an array
                     if (
                        prepareContext.data != null &&
                        !Array.isArray(prepareContext.data)
                     )
                        prepareContext.data = [prepareContext.data];

                     next(prepareContext);
                  });

                  // NOTE: Use new ABQLSetPluck instance because ignore call this.next.do function to mess up the chain variable
                  let setPluck = new ABQLSetPluck(
                     {
                        fieldID: this.fieldID,
                     },
                     this,
                     null,
                     this.AB
                  );
                  setPluck.object = this.object;
                  return setPluck.do(prepareChain, instance, trx, req);
               })
               // change label from "ABQLSetPluck" to "ABQLRowPluck"
               .then((context) => {
                  let nextContext = this.AB.clone(context);
                  nextContext.label = "ABQLRowPluck";

                  // Clean up the data to match the pluck field
                  if (nextContext.data) {
                     // If the pluck field is the M:N, M:1 connect field, then it should pass an array data
                     if (
                        this.fieldID != "_PK" &&
                        (this.field.key == "connectObject" ||
                           this.field.key == "user") &&
                        this.field.settings.linkType == "many"
                     ) {
                        // Convert to an array
                        if (!Array.isArray(nextContext.data))
                           nextContext.data = [nextContext.data];
                     }
                     // Normal field should pass a single object value
                     else if (Array.isArray(nextContext.data)) {
                        if (nextContext.data.length > 1) {
                           this.process.log(
                              `The data values have more than 1. "${this.field.columnName}" does not support multiple values.`
                           );
                           nextContext.data = nextContext.data[0];
                        } else if (nextContext.data.length == 1) {
                           nextContext.data = nextContext.data[0];
                        } else if (nextContext.data.length < 1) {
                           nextContext.data = null;
                        }
                     }
                  }

                  return nextContext;
               })
         );
      });

      if (this.next) {
         return this.next.do(nextLink, instance, trx, req);
      } else {
         return nextLink;
      }
   }
}

module.exports = ABQLRowPluck;
