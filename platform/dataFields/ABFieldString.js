/*
 * ABFieldString
 *
 * An ABFieldString defines a string field type.
 *
 */
const path = require("path");
const _ = require("lodash");
const async = require("async");

// prettier-ignore
const ABFieldStringCore = require(path.join(__dirname, "..", "..", "core", "dataFields", "ABFieldStringCore.js"));

module.exports = class ABFieldString extends ABFieldStringCore {
   // constructor(values, object) {
   //    super(values, object);
   // }

   ///
   /// Instance Methods
   ///

   // isValid() {
   //    var errors = super.isValid();

   //    // errors = OP.Form.validationError({
   //    // 	name:'columnName',
   //    // 	message:L('ab.validation.object.name.unique', 'Field columnName must be unique (#name# already used in this Application)').replace('#name#', this.name),
   //    // }, errors);

   //    return errors;
   // }

   ///
   /// DB Migrations
   ///

   /**
    * @function migrateCreate
    * perform the necessary sql actions to ADD this column to the DB table.
    * @param {ABUtil.reqService} req
    *        the request object for the job driving the migrateXXX().
    * @param {knex} knex
    *        the Knex connection.
    * @return {Promise}
    */
   migrateCreate(req, knex) {
      knex = knex || this.AB.Knex.connection(this.object.connName);
      return new Promise((resolve, reject) => {
         var tableName = this.object.dbTableName();

         async.series(
            [
               // if this is a multilingual field, then manage a json
               // translation store:
               (next) => {
                  if (this.settings.supportMultilingual) {
                     // make sure there is a 'translations' json field
                     // included:
                     req.retry(() =>
                        knex.schema.hasColumn(tableName, "translations")
                     )
                        .then((exists) => {
                           // create one if it doesn't exist:
                           if (!exists) {
                              return req
                                 .retry(() =>
                                    knex.schema.table(tableName, (t) => {
                                       t.json("translations");
                                    })
                                 )
                                 .then(() => {
                                    next();
                                 })
                                 .catch((err) => {
                                    if (err.code == "ER_DUP_FIELDNAME") {
                                       next();
                                    } else {
                                       next(err);
                                    }
                                 });
                           } else next();
                        })
                        .catch(next);
                  } else next();
               },

               // create the actual column
               (next) => {
                  // [fix]: don't create a column for a multilingual field
                  if (!this.settings.supportMultilingual) {
                     req.retry(() =>
                        knex.schema.hasColumn(tableName, this.columnName)
                     )
                        .then((exists) => {
                           return req
                              .retry(() =>
                                 knex.schema.table(tableName, (t) => {
                                    var currCol = t.string(this.columnName);

                                    // default value
                                    if (
                                       this.settings.default &&
                                       this.settings.default.indexOf(
                                          "{uuid}"
                                       ) == -1
                                    )
                                       currCol.defaultTo(this.settings.default);
                                    else currCol.defaultTo(null);

                                    // not nullable/nullable
                                    if (
                                       this.settings.required &&
                                       this.settings.default
                                    )
                                       currCol.notNullable();
                                    else currCol.nullable();

                                    // field is unique
                                    if (this.settings.unique) {
                                       currCol.unique();
                                    }
                                    // NOTE: Wait for dropUniqueIfExists() https://github.com/tgriesser/knex/issues/2167
                                    // else {
                                    // 	t.dropUnique(this.columnName);
                                    // }

                                    if (exists) currCol.alter();
                                 })
                              )
                              .then(() => {
                                 return next();
                              })
                              .catch((err) => {
                                 // Skip duplicate unique key
                                 if (err.code == "ER_DUP_KEYNAME") resolve();
                                 else reject(err);
                              });
                        })
                        .catch(next);
                  } else {
                     // just continue.
                     next();
                  }
               },
            ],
            (err) => {
               if (err) reject(err);
               else resolve();
            }
         );
      });
   }

   /**
    * @function migrateUpdate
    * perform the necessary sql actions to MODIFY this column to the DB table.
    * @param {ABUtil.reqService} req
    *        the request object for the job driving the migrateXXX().
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
      // take a look here:  http://json-schema.org/example1.html

      if (this.settings.supportMultilingual) {
         // make sure our translations  column is setup:

         // if not already setup:
         if (!obj["translations"]) {
            obj.translations = {
               type: "array",
               items: {
                  type: "object",
                  properties: {
                     language_code: {
                        type: "string",
                     },
                  },
               },
            };
         }

         // make sure our column is described in the
         if (!obj.translations.items.properties[this.columnName]) {
            obj.translations.items.properties[this.columnName] = {
               type: "string",
            };
         }
      } else {
         // we're not multilingual, so just tack this one on:
         if (!obj[this.columnName]) {
            obj[this.columnName] = {
               anyOf: [
                  { type: "string" },
                  { type: "number" },
                  { type: "null" },
               ],
            };
         }
      }
   }

   /**
    * @method requestParam
    * return the entry in the given input that relates to this field.
    * @param {obj} allParameters  a key=>value hash of the inputs to parse.
    * @return {obj} or undefined
    */
   requestParam(allParameters) {
      var myParameter;

      // if we are a multilingual field, make sure the .translations data is
      // returned:
      if (this.settings.supportMultilingual) {
         if (allParameters.translations) {
            myParameter = {};
            myParameter.translations = allParameters.translations;
         }
      } else {
         myParameter = super.requestParam(allParameters);
      }

      if (typeof myParameter?.[this.columnName] == "string") {
         myParameter[this.columnName] = myParameter[this.columnName].trim();
      }

      return myParameter;
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

   /**
    * @method postGet
    * Perform any final conditioning of data returned from our DB table before
    * it is returned to the client.
    * @param {obj} data  a json object representing the current table row
    */
   postGet(data) {
      return new Promise((resolve /* , reject */) => {
         // if we are a multilingual field, make sure the .translations data is
         // an object and not a string.
         //// NOTE: a properly formatted json data in the .translations
         //// field should already be parsed as it is returned from
         //// objection.js query().
         if (this.settings.supportMultilingual) {
            if (_.isString(data.translations)) {
               try {
                  data.translations = JSON.parse(data.translations);
               } catch (e) {
                  console.log(e);
               }
            }
         }

         resolve();
      });
   }
};
