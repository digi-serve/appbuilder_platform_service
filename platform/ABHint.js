// import ABApplication from "./ABApplication"
// const ABApplication = require("./ABApplication"); // NOTE: change to require()
const ABHintCore = require("../core/ABHintCore.js");

module.exports = class ABHint extends ABHintCore {
   constructor(attributes, AB) {
      super(attributes, AB);

      // listen
   }

   ///
   /// Static Methods
   ///
   /// Available to the Class level object.  These methods are not dependent
   /// on the instance values of the Application.
   ///

   /**
    * context()
    * Return an initial context data structure for use with a running
    * instance.
    * @param {obj} data the initial data passed into the process
    * @return {Promise}
    */
   context(data) {
      return {
         input: data,
         taskState: {},
      };
   }

   /**
    * @method exportData()
    * export the relevant data from this object necessary for the operation of
    * it's associated application.
    * @param {hash} data
    *        The incoming data structure to add the relevant export data.
    *        .ids {array} the ABDefinition.id of the definitions to export.
    *        .siteObjectConnections {hash} { Obj.id : [ ABField.id] }
    *                A hash of Field.ids for each System Object that need to
    *                reference these importedFields
    *        .roles {hash}  {Role.id: RoleDef }
    *                A Definition of a role related to this Application
    *        .scope {hash} {Scope.id: ScopeDef }
    *               A Definition of a scope related to this Application.
    *               (usually from one of the Roles being included)
    */
   exportData(data) {
      if (!this.isSystemObject || data.settings.includeSystemObjects) {
         // make sure we don't get into an infinite loop:
         if (data.ids.indexOf(this.id) > -1) return;

         data.ids.push(this.id);

         // store our elements:
         this.steps().forEach((s) => {
            s.exportData(data);
         });
      }
   }

   /**
    * @method exportIDs()
    * export any relevant .ids for the necessary operation of this application.
    * @param {array} ids
    *        the array of ids to store our relevant .ids into.
    */
   exportIDs(ids) {
      // make sure we don't get into an infinite loop:
      if (ids.indexOf(this.id) > -1) return;

      ids.push(this.id);

      // store our steps:
      this?.stepIDs.forEach((s) => {
         if (ids.indexOf(s) > -1) return;
         ids.push(s);
      });
   }

   /**
    * @method save()
    *
    * persist this instance of ABObject with it's parent ABApplication
    *
    *
    * @return {Promise}
    *						.resolve( {this} )
    */
   save() {
      // if this is an update:
      // if (this.id) {
      // 	return ABDefinition.update(this.id, this.toDefinition());
      // } else {

      // 	return ABDefinition.create(this.toDefinition());
      // }

      return this.toDefinition()
         .save()
         .then((data) => {
            // if I didn't have an .id then this was a create()
            // and I need to update my data with the generated .id

            if (!this.id) {
               this.id = data.id;
            }
         });
   }

   isValid() {
      return true;
      // var isValid =
      //    this.AB.processes((o) => {
      //       return o.name.toLowerCase() == this.name.toLowerCase();
      //    }).length == 0;
      // return isValid;
   }
};
