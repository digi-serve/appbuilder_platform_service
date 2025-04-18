const CalculateTaskCore = require("../../../core/process/tasks/ABProcessTaskServiceCalculateCore.js");

module.exports = class CalculateTask extends CalculateTaskCore {
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
   do(instance /* , trx, req */) {
      this.stateCompleted(instance);
      return Promise.resolve(true);
   }

   ///// LEFT OFF HERE:

   // Q:  Is this supposed to be on the server side?

   /**
    * @method processData()
    * return the current value requested for the given data key.
    * @param {obj} instance
    * @return {mixed} | null
    */
   processData(instance, key) {
      const parts = (key || "").split(".");
      if (parts[0] != this.id) return null;

      let formula = this.formulaText || "";

      (this.process.processDataFields(this) || []).forEach((item) => {
         if (formula.indexOf(item.label) < 0) return;

         let processedData =
            this.process.processData(this, [instance, item.key]) || 0;

         // Escape brackets (,) in label so that the regex works
         const label = item.label.replace(/\(/, "\\(").replace(/\)/, "\\)");
         formula = formula.replace(
            new RegExp(`{${label}}`, "g"),
            processedData == null ? 0 : processedData,
         );
      });

      // Allow only Number, Operators (+ - * /)
      formula = formula.replace(/[^\d+\-*/().]*/g, "");

      return eval(formula);
   }
};
