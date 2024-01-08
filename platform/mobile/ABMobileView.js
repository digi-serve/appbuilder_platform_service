const ABMobileViewCore = require("../../core/mobile/ABMobileViewCore.js");

module.exports = class ABMobileView extends ABMobileViewCore {
   // constructor(attributes, application, parent) {
   //    super(attributes, application, parent);
   // }

   warningsAll() {
      // report both OUR warnings, and any warnings from any of our sub views
      var allWarnings = super.warningsAll();
      this.views().forEach((v) => {
         allWarnings = allWarnings.concat(v.warningsAll());
      });

      (this.pages?.() || []).forEach((p) => {
         allWarnings = allWarnings.concat(p.warningsAll());
      });

      return allWarnings.filter((w) => w);
   }

   warningsEval() {
      super.warningsEval();

      let allViews = this.views();

      (this.__missingViews || []).forEach((id) => {
         this.warningsMessage(`references unknown View[${id}]`);
      });

      allViews.forEach((v) => {
         v.warningsEval();
      });

      // if a datacollection is specified, verify it can be accessed.
      if (this.settings.dataviewID) {
         let dc = this.datacollections || this.datacollection;
         if (!dc) {
            this.warningsMessage(
               `references unknown dataviewID[${this.settings.dataviewID}]`
            );
         }
      }
   }

   warningsMessage(msg, data = {}) {
      let message = `${this.key}[${this.name}]: ${msg}`;
      this._warnings.push({ message, data });
   }
};
