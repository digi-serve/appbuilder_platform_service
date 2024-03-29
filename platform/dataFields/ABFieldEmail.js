/*
 * ABFieldBoolean
 *
 * An ABFieldBoolean defines a Date field type.
 *
 */
const path = require("path");
// prettier-ignore
const ABFieldEmailCore = require(path.join(__dirname, "..", "..", "core", "dataFields", "ABFieldEmailCore.js"));

module.exports = class ABFieldEmail extends ABFieldEmailCore {
   // constructor(values, object) {
   //    super(values, object);
   // }

   ///
   /// Instance Methods
   ///

   isValid() {
      var errors = super.isValid();

      // errors = OP.Form.validationError({
      // 	name:'columnName',
      // 	message:L('ab.validation.object.name.unique', 'Field columnName must be unique (#name# already used in this Application)').replace('#name#', this.name),
      // }, errors);

      return errors;
   }

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
                        var currCol = t.string(this.columnName, 254);
                        // Technically we are limited to 254 characters in an email:
                        // https://stackoverflow.com/questions/386294/what-is-the-maximum-length-of-a-valid-email-address

                        // default value
                        if (this.settings.default)
                           currCol.defaultTo(this.settings.default);
                        else currCol.defaultTo(null);

                        // field is required (not null)
                        if (this.settings.required && this.settings.default) {
                           currCol.notNullable();
                        } else {
                           currCol.nullable();
                        }

                        // field is unique
                        if (this.settings.unique) {
                           currCol.unique();
                        }
                        // NOTE: Wait for dropUniqueIfExists() https://github.com/tgriesser/knex/issues/2167
                        // else {
                        // 	t.dropUnique(this.columnName);
                        // }

                        // alter column when exist:
                        if (exists) {
                           currCol.alter();
                        }
                     })
                  )
                  .then(() => {
                     resolve();
                  })
                  .catch((err) => {
                     // Skip duplicate unique key
                     if (err.code == "ER_DUP_KEYNAME") resolve();
                     else reject(err);
                  });
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

   /**
    * @method jsonSchemaProperties
    * register your current field's properties here:
    */
   jsonSchemaProperties(obj) {
      // take a look here:  http://json-schema.org/example1.html

      // if our field is not already defined:
      if (!obj[this.columnName]) {
         obj[this.columnName] = { type: "string" };
      }
   }

   /**
    * @method requestParam
    * return the entry in the given input that relates to this field.
    * @param {obj} allParameters  a key=>value hash of the inputs to parse.
    * @return {obj} or undefined
    */
   requestParam(allParameters) {
      var myParameter = super.requestParam(allParameters);

      return myParameter;
   }

   /**
    * @method isValidParams
    * Parse through the given parameters and return an error if this field's
    * data seems invalid.
    * @param {obj} allParameters  a key=>value hash of the inputs to parse.
    * @return {array}
    */
   isValidData(allParameters) {
      var errors = [];

      if (allParameters[this.columnName]) {
         var Reg = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;

         var value = allParameters[this.columnName];
         value = String(value).toLowerCase();
         if (!Reg.test(value)) {
            errors.push({
               name: this.columnName,
               message: "Invalid email",
               value: value,
            });
         }
      }

      return errors;
   }
};
