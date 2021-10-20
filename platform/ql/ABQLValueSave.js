/*
 * ABQLValueSave
 *
 * An ABQLValueSave can store the current Data field set into the Process Task it is
 * in, so that this data can be made available to other Process Tasks.
 *
 */

const ABQLValueSaveCore = require("../../core/ql/ABQLValueSaveCore.js");

class ABQLValueSave extends ABQLValueSaveCore {
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
      let nextLink = super
         .do(chain, instance, trx, req)
         // change label from "ABQLSetSave" to "ABQLValueSave"
         .then((context) => {
            context.label = "ABQLValueSave";
            return context;
         });

      if (this.next) {
         return this.next.do(nextLink, instance, trx, req);
      } else {
         return nextLink;
      }
   }
}

module.exports = ABQLValueSave;
