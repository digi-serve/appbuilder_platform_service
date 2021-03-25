const path = require("path");
// prettier-ignore
const ABProcessTaskServiceCore = require(path.join(__dirname, "..", "..", "..", "core", "process", "tasks", "ABProcessTaskServiceCore.js"));
// prettier-ignore
const ABProcessParticipant = require(path.join(__dirname, "..", "ABProcessParticipant"));

module.exports = class ABProcessTaskService extends ABProcessTaskServiceCore {
   ////
   //// Process Instance Methods
   ////

   /**
    * do()
    * this method actually performs the action for this task.
    * @param {obj} instance  the instance data of the running process
    * @return {Promise}
    *      resolve(true/false) : true if the task is completed.
    *                            false if task is still waiting
    */
   do(instance /* , dbTransaction, req */) {
      return new Promise((resolve, reject) => {
         var myState = this.myState(instance);

         var msg =
            "ABProcessTaskService should not be processed in a .do() block.";
         var badCallError = new Error(msg);
         console.error(msg);
         reject(badCallError);
         return;
      });
   }
};
