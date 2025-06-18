const ABObject = require("../ABObject.js");

module.exports = class ABObjectPlugin extends ABObject {
   constructor(attributes, AB) {
      super(attributes || {}, AB);
      this.isPlugin = true;
   }

   static getPluginKey() {
      console.error("ABObjectPlugin.getPluginKey() not overwritten!");
      return "ab-object-plugin";
   }

   /**
    * @method fromValues()
    *
    * create an Instance of an ABObject from the provided json attributes
    * object passed in.
    */
   fromValues(attributes) {
      super.fromValues(attributes);
      this.plugin_key = this.constructor.getPluginKey();
   }

   /**
    * @method toObj()
    *
    * properly compile the current state of this ABObjectQuery instance
    * into the values needed for saving to the DB.
    *
    * @return {json}
    */
   toObj() {
      const result = super.toObj();
      result.isPlugin = true;
      result.plugin_key = this.constructor.getPluginKey();
      return result;
   }

   ////
   //// Need to overwrite these!
   ////

   /**
    * migrateCreate
    * verify that a table for this object exists.
    * @param {ABUtil.reqService} req
    *        the request object for the job driving the migrateCreate().
    * @param {knex} knex
    *        the Knex connection.
    * @return {Promise}
    */
   // async migrateCreate(req, knex) {
   //    console.log(`ABObjectPlugin[${this.key}]: migrateCreate() not overwritten!`);
   // }

   /**
    * migrateDropTable
    * remove the table for this object if it exists.
    * @param {ABUtil.reqService} req
    *        the request object for the job driving the migrateCreate().
    * @param {Knex} knex
    *        the knex sql library manager for manipulating the DB.
    * @return {Promise}
    */
   // async migrateDrop(req, knex) {
   //    console.log(`ABObjectPlugin[${this.key}]: migrateCreate() not overwritten!`);
   // }

   /**
    * @method model
    * return a Model object that will allow you to interact with the data for
    * this ABObjectQuery.
    */
   // model() {
   //    var model = new ABModelApiNetsuite(this);

   //    // default the context of this model's operations to this object
   //    model.contextKey(this.constructor.contextKey());
   //    model.contextValues({ id: this.id });

   //    return model;
   // }
};
