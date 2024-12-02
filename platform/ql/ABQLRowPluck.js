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
                  const nextContext = this.AB.clone(context);
                  nextContext.label = "ABQLRowPluck";
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
