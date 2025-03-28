const ABProcessTaskUserFormCore = require("../../../core/process/tasks/ABProcessTaskUserFormCore.js");

module.exports = class ABProcessTaskUserForm extends (
   ABProcessTaskUserFormCore
) {
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
      return new Promise((resolve, reject) => {

         const userId = this._req?._user?.id;
         if (!userId) return resolve(true);

         // If the form input are set, then go to the next task
         const myState = this.myState(instance);
         if (myState?._isSet) {
            this.stateCompleted(instance);
            return resolve(true);
         }

         // Call to display the input form popup.
         this._req.broadcast([
            {
               room: this._req.socketKey(userId),
               event: "ab.task.userform",
               data: {
                  processId: this.process.id,
                  taskId: this.id,
                  instanceId: instance.id,
                  formio: this.formBuilder,
               },
            },
         ], (err) => {
            if (err) return reject(err);

            // Pause before running the next task. It will proceed once it receives the input data.
            resolve(false);
         });
      });
   }

   enterInputs(instance, values = null) {
      if (values) {
         if (typeof values == "string") {
            values = JSON.parse(values);
         }
         values._isSet = true;
         this.stateCompleted(instance);
      }

      this.stateUpdate(instance, values);
   }
};
