// import ABApplication from "./ABApplication"

var ABDefinitionCore = require("../core/ABDefinitionCore");

module.exports = class ABDefinition extends ABDefinitionCore {
   ///
   /// Static Methods
   ///
   /// Available to the Class level object.  These methods are not dependent
   /// on the instance values of the Application.
   ///

   /**
    * @method create()
    *
    * create a given ABDefinition
    *
    * @param {obj} data   the values of the ABDefinition obj
    * @return {Promise}   the updated value of the ABDefinition entry from the server.
    */
   static create(/* data */) {
      var errorDepreciated = new Error(
         "ABDefinition.create(): Depreciated! Who is calling this!"
      );
      console.error(errorDepreciated);
      throw errorDepreciated;
   }

   /**
    * @method destroy()
    *
    * remove a given ABDefinition
    *
    * @param {obj} data   the values of the ABDefinition obj
    * @return {Promise}   the updated value of the ABDefinition entry from the server.
    */
   static destroy(/*id */) {
      var errorDepreciated = new Error(
         "ABDefinition.destroy(): Depreciated! Who is calling this!"
      );
      console.error(errorDepreciated);
      throw errorDepreciated;
   }

   /**
    * @method loadAll()
    *
    * load all the Definitions for The current AppBuilder:
    *
    * @return {array}
    */
   static loadAll() {
      var errorDepreciated = new Error(
         "ABDefinition.loadAll(): Depreciated! Who is calling this!"
      );
      console.error(errorDepreciated);
      throw errorDepreciated;
   }

   /**
    * @method update()
    *
    * update a given ABDefinition
    *
    * @param {string} id  the id of the definition to update
    * @param {obj} data   the values of the ABDefinition obj
    * @return {Promise}   the updated value of the ABDefinition entry from the server.
    */
   static update(/* id, data */) {
      var errorDepreciated = new Error(
         "ABDefinition.update(): Depreciated! Who is calling this!"
      );
      console.error(errorDepreciated);
      throw errorDepreciated;
   }

   /**
    * @method definition()
    *
    * return the current Definition data for the requested object id.
    *
    * Note: this returns the actual ABDefinition.json data that our System
    * objects can use to create a new instance of itself.  Not the ABDefinition
    * itself.
    *
    * @param {string} id  the id of the definition to update
    * @return {obj}   the updated value of the ABDefinition entry from the server.
    */
   static definition(/* id */) {
      var errorDepreciated = new Error(
         "ABDefinition.definition(): Depreciated! Who is calling this!"
      );
      console.error(errorDepreciated);
      throw errorDepreciated;
   }

   /**
    * @method definitions()
    *
    * return the definitions that match the provided filter fn.
    *
    * Note: this returns the actual ABDefinition.json data that our System
    * objects can use to create a new instance of itself.  Not the ABDefinition
    * itself.
    *
    * @param {string} id  the id of the definition to update
    * @return {obj}   the updated value of the ABDefinition entry from the server.
    */
   static definitions(/* fn = () => true */) {
      var errorDepreciated = new Error(
         "ABDefinition.definitions(): Depreciated! Who is calling this!"
      );
      console.error(errorDepreciated);
      throw errorDepreciated;
   }

   static allQueries(/* fn = () => true */) {
      var errorDepreciated = new Error(
         "ABDefinition.allQueries(): Depreciated! Who is calling this!"
      );
      console.error(errorDepreciated);
      throw errorDepreciated;
   }

   //
   // Instance Methods
   //
};
