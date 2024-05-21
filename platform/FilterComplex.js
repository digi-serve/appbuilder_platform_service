const FilterComplexCore = require("../core/FilterComplexCore");

module.exports = class FilterComplex extends FilterComplexCore {
   constructor(idBase, AB) {
      idBase = idBase || "ab_row_filter";

      super(idBase, AB);
   }

   /**
    * @method isConditionComplete()
    * Check a given condition entry and indicate if it is fully
    * filled out.
    * @param {obj} cond
    *        The Condition object we are checking.  If a Macro
    *        condition if provided: { glue:"and", rules:[] } then
    *        this method will return True/False if All rules are
    *        complete.
    *        If an individual rule is provided, then it evaluates
    *        the completness of that rule. { key, rule, value }
    * @return {bool}
    */
   isConditionComplete(cond) {
      if (!cond) return false;

      let isComplete = true;
      // start optimistically.

      if (cond?.glue) {
         (cond.rules || []).forEach((r) => {
            isComplete = isComplete && this.isConditionComplete(r);
         });
      } else {
         // every condition needs a .key & .rule
         if (!cond.key || cond.key == "") {
            isComplete = false;
         }

         if (!cond.rule || cond.rule == "") {
            isComplete = false;
         }

         if (isComplete) {
            switch (cond.rule) {
               case "same_as_user":
               case "is_current_user":
               case "is_not_current_user":
               case "contain_current_user":
               case "not_contain_current_user":
                  // There are only a few rules that don't need a
                  // value
                  break;

               default:
                  // The rest do need a .value
                  if (!cond.value || cond.value == "") {
                     isComplete = false;
                  }
                  break;
            }
         }
      }

      return isComplete;
   }

   fieldsLoad(fields = [], object = null) {
      super.fieldsLoad(fields, object);
   }

   toShortHand() {
      return "Add Filters";
   }
};
