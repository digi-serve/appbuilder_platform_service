/*
 * ABFieldJson
 *
 * An ABFieldJson defines a JSON field type.
 *
 */
const path = require("path");
// prettier-ignore
const ABFieldJsonCore = require(path.join(__dirname, "..", "..", "core", "dataFields", "ABFieldJsonCore.js"));

module.exports = class ABFieldJson extends ABFieldJsonCore {
   // constructor(values, object) {
   //    super(values, object);
   // }

   ///
   /// DB Migrations
   ///

   /**
    * @function migrateCreate
    * perform the necessary sql actions to ADD this column to the DB table.
    * @param {ABUtil.reqService} req
    *        the request object for the job driving the migrateCreate().
    * @param {knex} knex
    *        the Knex connection.
    * @return {Promise}
    */
   migrateCreate(req, knex) {
      knex = knex || this.AB.Knex.connection(this.object.connName);

      return new Promise((resolve, reject) => {
         var tableName = this.object.dbTableName();

         // if this column doesn't already exist (you never know)
         req.retry(() => knex.schema.hasColumn(tableName, this.columnName))
            .then((exists) => {
               return req
                  .retry(() =>
                     knex.schema.table(tableName, (t) => {
                        var currCol = t.json(this.columnName);
                        currCol.nullable();

                        if (exists) currCol.alter();
                     })
                  )
                  .then(() => {
                     resolve();
                  })
                  .catch(reject);
            })
            .catch(reject);
      });
   }

   /**
    * @function migrateUpdate
    * perform the necessary sql actions to MODIFY this column to the DB table.
    * @param {ABUtil.reqService} req
    *        the request object for the job driving the migrateCreate().
    * @param {knex} knex
    *        the Knex connection.
    * @return {Promise}
    */
   migrateUpdate(...params) {
      return this.migrateCreate(...params);
   }

   ///
   /// DB Model Services
   ///

   /**
    * @method jsonSchemaProperties
    * register your current field's properties here:
    */
   jsonSchemaProperties(obj) {
      // obj[this.columnName] = { type: 'object' }
      // obj[this.columnName] = { type: 'string' }
      obj[this.columnName] = {
         type: ["string", "object", "array", "null"],
      };
   }

   /**
    * @method isValidParams
    * Parse through the given parameters and return an error if this field's
    * data seems invalid.
    * @param {obj} allParameters  a key=>value hash of the inputs to parse.
    * @return {array}
    */
   isValidData(/* allParameters */) {
      return [];
   }
};
