const FNABModelNetsuiteAPI = require("./ModelNetsuite.js");

module.exports = function FNObjectNetsuite({
   /*AB,*/ ABObjectPlugin,
   ABModelPlugin,
}) {
   const ABModelNetsuiteAPI = FNABModelNetsuiteAPI({ ABModelPlugin });

   return class ABObjectNetsuiteAPI extends ABObjectPlugin {
      constructor(...params) {
         super(...params);

         this.isNetsuite = true;
         console.log("ABObjectNetsuiteAPI  BABY!!!!");
         console.log("id:", this.id);
         console.log("name:", this.name);
      }

      static getPluginKey() {
         return "ab-object-netsuite-api";
      }

      fromValues(attributes) {
         super.fromValues(attributes);

         this.plugin_key = this.constructor.getPluginKey();
         this.credentials = attributes.credentials ?? {};
         this.columnRef = attributes.columnRef ?? {};
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

         result.plugin_key = this.constructor.getPluginKey();
         result.isNetsuite = true;
         result.credentials = this.credentials;
         result.columnRef = this.columnRef;

         return result;
      }

      /**
       * @method model
       * return a Model object that will allow you to interact with the data for
       * this ABObjectQuery.
       */
      model() {
         var model = new ABModelNetsuiteAPI(this);

         // default the context of this model's operations to this object
         model.contextKey(this.constructor.contextKey());
         model.contextValues({ id: this.id }); // the datacollection.id

         return model;
      }

      /**
       * migrateCreate
       * This implementation of ObjectNetsuite does not create a local table.
       * @param {ABUtil.reqService} req
       *        the request object for the job driving the migrateCreate().
       * @param {knex} knex
       *        the Knex connection.
       * @return {Promise}
       */
      async migrateCreate(/* req, knex */) {
         return Promise.resolve();
      }

      /**
       * migrateDrop
       * This implementation of ObjectNetsuite does not create a local table.
       * @param {ABUtil.reqService} req
       *        the request object for the job driving the migrateCreate().
       * @param {Knex} knex
       *        the knex sql library manager for manipulating the DB.
       * @return {Promise}
       */
      async migrateDrop(/* req, knex */) {
         return Promise.resolve();
      }
   };
};
