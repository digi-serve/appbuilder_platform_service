// import ABApplication from "./ABApplication"
// const ABApplication = require("./ABApplication"); // NOTE: change to require()
const ABProcessTaskServiceGetResetPasswordUrlCore = require("../../../core/process/tasks/ABProcessTaskServiceGetResetPasswordUrlCore.js");

module.exports = class ABProcessTaskServiceGetResetPasswordUrl extends (
   ABProcessTaskServiceGetResetPasswordUrlCore
) {
   /**
    * @method do()
    * this method actually performs the action for this task.
    * @param {obj} instance
    *        the instance data of the running process
    * @param {Knex.Transaction?} trx
    *        (optional) Knex Transaction instance.
    * @param {ABUtil.reqService} req
    *        an instance of the current request object for performing tenant
    *        based operations.
    * @return {Promise}
    *        resolve(true/false) : true if the task is completed.
    *                            false if task is still waiting
    */
   do(instance /*, trx, req */) {
      this.stateCompleted(instance);
      const email = this.getProcessValue(instance.context, this.email) ?? null;
      return new Promise((resolve, reject) => {
         this.AB.req.serviceRequest(
            "user_manager.user-password-reset-url",
            {
               email
            },
            (err, results) => {
               if (err) {
                  console.error(err);

                  reject(err);
               }

               this.stateUpdate(instance, { url: results.data });

               resolve(true);
            }
         );
      });
   }

   /**
    * Get data from a previous process task
    * @function getProcessValue
    * @param {object} context the current isntance's context
    * @param {string} key the key for the process datafield (expected format taskId.fieldDefinitionId)
    */
   getProcessValue(context, key) {
      const [taskId, fieldId] = key.split(".");
      const { columnName } = this.AB.definitionByID(fieldId);
      return context.taskState[taskId]?.data[columnName];
   }

   /**
    * @method processData()
    * return the current value requested for the given data key.
    * @param {obj} instance
    * @return {mixed} | null
    */
   processData(instance, key) {
      const parts = (key || "").split(".");
      if (parts[0] != this.id) return null;

      const myState = this.myState(instance);
      return myState[parts[1]];
   }
};
