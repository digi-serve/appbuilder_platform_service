/*
 * ABQLRootObject
 *
 * An ABQL defines a Query Language Operation. A QL Operation
 * is intended to be evaluated at run time and return a value that can be
 * assigned to form value or an object.
 *
 *
 */

const ABQLRootObjectCore = require("../../core/ql/ABQLRootObjectCore.js");

class ABQLObject extends ABQLRootObjectCore {
   // constructor(attributes, task, AB) {
   //     // NOTE: keep this so we can insert the prevOp == null
   //     super(attributes, ParameterDefinitions, null, task, AB);
   // }

   ///
   /// Instance Methods
   ///

   /**
    * do()
    * perform the action for this Query Language Operation.
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
   do(instance, trx, req) {
      // create a Promise chain for our actions.
      var chain = Promise.resolve().then(() => {
         // now we will craft a {context} object, and pass it along
         // to the next operation:
         var context = {
            label: "ABQLRootObject",
            object: this.object,
            data: null,
         };

         return context;
      });

      if (this.next) {
         // the next action will receive the chain and add to it
         return this.next.do(chain, instance, trx, req);
      } else {
         // if this is the last action, we just return the promise
         return chain;
      }
   }
}

module.exports = ABQLObject;
