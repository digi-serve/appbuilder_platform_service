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

      return new Promise((resolve, reject) => {
         try {
            this.AB.req.serviceRequest(
               "user_manager.user-password-reset-url",
               {
                  email: this.email,
                  url: this.url,
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
         } catch (err) {
            console.error(err);

            reject(false);
         }
      });
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
