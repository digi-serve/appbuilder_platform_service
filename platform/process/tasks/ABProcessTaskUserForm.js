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
         if (!userId) return resolve(false);

         // Call to display the input form popup.
         this._req.broadcast([
            {
               room: this._req.socketKey(userId),
               event: "ab.task.userform",
               data: {
                  taskId: this.id,
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

   // TODO
   // const states = {};

   // (this.formBuilder?.components ?? []).forEach((comp) => {
   //    if (comp.type == "button") return;

   //    states[comp.key] = "TODO";
   // });

   // this.stateUpdate(instance, states);
   // this.stateCompleted(instance);

};
