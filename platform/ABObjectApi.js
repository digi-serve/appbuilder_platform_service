const ABObjectApiCore = require("../core/ABObjectApiCore");

module.exports = class ABObjectApi extends ABObjectApiCore {
   /**
    * migrateCreate
    * verify that a table for this object exists.
    * @param {ABUtil.reqService} req
    *        the request object for the job driving the migrateCreate().
    * @param {knex} knex
    *        the Knex connection.
    * @return {Promise}
    */
   async migrateCreate(/*req, knex*/) {
      const createTasks = [];

      // Encrypt/Store secrets of the API Object
      if (this.secrets) {
         this.AB.Secret.create(this.id, ...this.secrets);
      }

      return Promise.all(createTasks);
   }

   /**
    * migrateDropTable
    * remove the table for this object if it exists.
    * @param {ABUtil.reqService} req
    *        the request object for the job driving the migrateCreate().
    * @param {Knex} knex
    *        the knex sql library manager for manipulating the DB.
    * @return {Promise}
    */
   async migrateDrop(req, knex) {
      const dropTasks = [];
      const modelKey = this.AB.objectKey().model();
      const modelSecret = this.AB.objectSecret().model();

      // Remove this API Object
      dropTasks.push(super.migrateDrop(req, knex));

      // Remove private keys of this API Object
      dropTasks.push(
         modelKey
            .modelKnex()
            .query()
            .delete()
            .where("DefinitionID", "=", this.id)
      );

      // Remove secret values of this API Object
      dropTasks.push(
         modelSecret
            .modelKnex()
            .query()
            .delete()
            .where("DefinitionID", "=", this.id)
      );

      return Promise.all(dropTasks);
   }

   async getSecretValue(secretName) {
      return this.AB.Secret.getValue(this.id, secretName);
   }
};
