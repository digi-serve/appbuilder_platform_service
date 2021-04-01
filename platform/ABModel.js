const ABModelCore = require("../core/ABModelCore");
const Model = require("objection").Model;

const ABFieldDateTime = require("../core/dataFields/ABFieldDateTimeCore");

const _ = require("lodash");

var __ModelPool = {};
// reuse any previously created Model connections
// to minimize .knex bindings (and connection pools!)

var conditionFields = ["sort", "offset", "limit", "populate"];
// the list of fields on a provided .findAll(cond) param that we should
// consider when parsing the object.

module.exports = class ABModel extends ABModelCore {
   /**
    * @method create
    * performs an update operation
    * @param {obj} values
    *    A hash of the new values for this entry.
    * @param {Knex.Transaction?} trx - [optional]
    * @param {ABUtil.reqApi} req
    *    The request object associated with the current tenant/request
    * @return {Promise} resolved with the result of the find()
    */
   create(values, trx = null, condDefaults = null, req = null) {
      values = this.object.requestParams(values);

      // make sure a UUID is set
      var PK = this.object.PK();
      if (PK === "uuid" && values[PK] == null) {
         values[PK] = this.AB.uuid();
      }

      // created_at & updated_at
      var date = this.AB.rules.toSQLDateTime(new Date());
      values["created_at"] = values["created_at"] || date;
      values["updated_at"] = values["updated_at"] || date;

      let validationErrors = this.object.isValidData(values);
      if (validationErrors.length > 0) {
         return Promise.reject(validationErrors);
      }

      return new Promise((resolve, reject) => {
         // get a Knex Query Object
         let query = this.modelKnex().query();

         // Used by knex.transaction, the transacting method may be chained to any query and
         // passed the object you wish to join the query as part of the transaction for.
         if (trx) query = query.transacting(trx);

         // update our value
         query
            .insert(values)
            .then((returnVals) => {
               if (req) {
                  req.log(
                     `${
                        this.object.label || this.object.name
                     }.create() successful. Now loading full value from DB.`
                  );
               }

               // make sure we get a fully updated value for
               // the return value
               this.findAll(
                  {
                     where: {
                        glue: "and",
                        rules: [
                           {
                              key: PK,
                              rule: "equals",
                              value: returnVals[PK],
                           },
                        ],
                     },
                     offset: 0,
                     limit: 1,
                     populate: true,
                  },
                  condDefaults,
                  req
               )
                  .then((rows) => {
                     // this returns an [] so pull 1st value:
                     resolve(rows[0]);
                  })
                  .catch(reject);
            })
            .catch((error) => {
               // populate any error messages with the SQL of this
               // query:
               error._sql = query.toString();
               reject(error);
            });
      });
   }

   /**
    * @method delete
    * performs a delete operation
    * @param {string} id
    *    the primary key for this update operation.
    * @param {Knex.Transaction?} trx - [optional]
    *
    * @return {Promise} resolved with {int} numRows : the # rows affected
    */
   delete(id, trx = null) {
      return new Promise((resolve, reject) => {
         // get a Knex Query Object
         let query = this.modelKnex().query();

         // Used by knex.transaction, the transacting method may be chained to any query and
         // passed the object you wish to join the query as part of the transaction for.
         if (trx) query = query.transacting(trx);

         var PK = this.object.PK();

         // update our value
         query
            .delete()
            .where(PK, "=", id)
            .then((countRows) => {
               resolve(countRows);
            })
            .catch((error) => {
               // populate any error messages with the SQL of this
               // query:
               error._sql = query.toString();
               reject(error);
            });
      });
   }

   /**
    * convertToFieldKeys()
    * when receiving condition statements in the .find() method, we can receive
    * conditions as [colName] : value.  For our .findAll() to process them, we
    * need to convert them to [field.id] : value entries.
    *
    * This method replaces the condition values in place.
    * @param {obj} cond
    *        The incoming { where:{cond} } clause for our .find()
    */
   convertToFieldKeys(cond) {
      var hashColumnNames = {
         /* .columnName : .id */
      };
      // {obj}
      // a quick lookup of any fields this object has

      // create lookup hash
      this.object.fields().forEach((f) => {
         hashColumnNames[f.columnName] = f.id;
      });

      var parseCondition = (where) => {
         var typeOf = typeof where;
         switch (typeOf) {
            case "string":
            case "number":
               return where;
               break;
            case "object":
               if (Array.isArray(where)) {
                  var newVals = [];
                  where.forEach((w) => {
                     newVals.push(parseCondition(w));
                  });
                  return newVals;
               }
               break;
         }

         // if we get to here, then this is an { col:value } format.
         Object.keys(where).forEach((k) => {
            if (k != "and" && k != "or") {
               // replace current entry if a match is found
               if (hashColumnNames[k]) {
                  where[hashColumnNames[k]] = parseCondition(where[k]);
                  delete where[k];
               }
            } else {
               //// here:
               var newCond = [];
               where[k].forEach((w) => {
                  newCond.push(parseCondition(w));
               });
               where[k] = newCond;
            }
         });

         return where;
      };

      parseCondition(cond.where);
   }

   /**
    * @method find()
    * a sails-like shorthand for the findAll() operations. This is a convienience
    * method for developers working directly with the object.model().find()
    * api.
    *
    * @param {obj} cond
    *        The provided condition can be in either a simple condition:
    *           { uuid: value}
    *        or in an expaned format:
    *           {
    *              where: {uuid: value},
    *              populate: false,
    *              offset: #,
    *              limit: #,
    *              sort: []
    *           }
    *
    * @param {abutils.reqService} req
    * @return {Promise}
    */
   find(cond, req) {
      var where = cond;
      if (!cond.where) {
         cond = {
            where: cond,
         };
      }

      var userDefaults = req;
      if (req && req.userDefaults) {
         userDefaults = req.userDefaults();
      }

      // incoming conditions use column names of fields, but we need to use
      // field.id(s) instead.
      this.convertToFieldKeys(cond);

      // convert cond into our expanded format:
      this.object.convertToQueryBuilderConditions(cond);

      // make sure any embedded conditions are properly reduced
      return this.object.reduceConditions(cond.where, userDefaults).then(() => {
         // perform the findAll()
         return this.findAll(cond, userDefaults, req).catch((err) => {
            if (["ECONNRESET", "ETIMEDOUT"].indexOf(err.code) > -1) {
               if (req) {
                  req.log(`.find() ${e.code} : retrying ...`);
               }
               return this.findAll(cond, userDefaults, req);
            }
            throw err;
         });
      });
   }

   /**
    * @method findAll
    * performs a data find with the provided condition.
    * @param {obj} cond
    *    A set of optional conditions to add to the find():
    * @param {obj} conditionDefaults
    *    A hash of default condition values.
    *    conditionDefaults.languageCode {string} the default language of
    *       the multilingual data to return.
    *    conditionDefaults.username {string} the username of the user
    *       we should reference on any user based condition
    * @return {Promise} resolved with the result of the find()
    */
   findAll(cond, conditionDefaults, req) {
      // make sure cond is defined, and in the EXPANDED format:
      // cond.where : {obj}
      //     queryBuilder condition format. This must ALREADY be reduced to
      //     the actual conditions.  No placeholders at this point.
      // cond.sort : {array}
      //     an array of { key:{field.id}, dir:["ASC", "DESC"] } sort
      //     definitions
      //  cond.offset: {int}
      //     the offset into the data set to start returning data.
      //  cond.limit: {int}
      //     the # of entries to return in this query
      // cond.populate: {bool}
      //     should we populate the connected fields of the entries
      //     returned?
      cond = cond || {};
      var defaultCond = {
         // where: cond,
         sort: [], // No Sorts
         offset: 0, // no offset
         limit: 0, // no limit
         populate: false, // don't populate the data
      };
      if (!cond.where) {
         // if we don't seem to have an EXPANDED format, see if we can
         // figure it out:

         conditionFields.forEach((f) => {
            if (!_.isUndefined(cond[f])) {
               defaultCond[f] = cond[f];
               delete cond[f];
            }
         });

         // store the rest as our .where cond
         defaultCond.where = cond;

         cond = defaultCond;
      } else {
         // make sure cond has our defaults set:
         conditionFields.forEach((f) => {
            if (_.isUndefined(cond[f])) {
               cond[f] = defaultCond[f];
            }
         });
      }

      // conditionDefaults is optional.  Some system tasks wont provide this.
      // but we need to provide some defaults to the queryConditions() to
      // process
      conditionDefaults = conditionDefaults || {};
      conditionDefaults.languageCode =
         conditionDefaults.languageCode ||
         // sails.config.appdev["lang.default"] ||
         "en";
      conditionDefaults.username = conditionDefaults.username || "_system_";

      return new Promise((resolve, reject) => {
         // get a Knex Query Object
         let query = this.modelKnex().query();

         // compile the conditions into the Knex Query
         this.queryConditions(query, cond.where, conditionDefaults);
         this.querySelectFormulaFields(query, conditionDefaults);
         this.queryIncludeExternalMultilingualFields(
            query,
            cond.where,
            cond.sort
         );

         // add sort into into Query
         if (cond.sort) {
            this.querySort(query, cond.sort, conditionDefaults);
         }

         // update the offset & limit
         if (cond.offset) {
            query.offset(cond.offset);
         }
         if (cond.limit) {
            query.limit(cond.limit);
         }

         // populate the data?
         this.queryPopulate(query, cond.populate);

         // TODO: test to see if we can pull the query.toString()
         // during the .catch() handler. Otherwise we movie it here.
         // var sql = query.toString();

         // perform the operation
         query
            .then((data) => {
               // normalize our Data before returning
               this.normalizeData(data);
               resolve(data);
            })
            .catch((error) => {
               // populate any error messages with the SQL of this
               // query:
               error._sql = query.toString();
               reject(error);
            });
      });
   }

   /**
    * @method findCount
    * performs a data find to get the total Count of a given condition.
    * @param {obj} cond
    *    A set of optional conditions to add to the find():
    * @param {obj} conditionDefaults
    *    A hash of default condition values.
    *    conditionDefaults.languageCode {string} the default language of
    *       the multilingual data to return.
    *    conditionDefaults.username {string} the username of the user
    *       we should reference on any user based condition
    * @return {Promise} resolved with the result of the find()
    */
   findCount(cond, conditionDefaults, req) {
      // make sure cond is defined, and in the EXPANDED format:
      // cond.where : {obj}
      //     queryBuilder condition format. This must ALREADY be reduced to
      //     the actual conditions.  No placeholders at this point.
      cond = cond || {};

      // conditionDefaults is optional.  Some system tasks wont provide this.
      // but we need to provide some defaults to the queryConditions() to
      // process
      conditionDefaults = conditionDefaults || {};
      conditionDefaults.languageCode =
         conditionDefaults.languageCode ||
         // sails.config.appdev["lang.default"] ||
         "en";
      conditionDefaults.username = conditionDefaults.username || "_system_";

      var tableName = this.object.dbTableName(true);

      return new Promise((resolve, reject) => {
         // get a Knex Query Object
         let query = this.modelKnex().query();

         // compile the conditions into the Knex Query
         this.queryConditions(query, cond.where, conditionDefaults);

         let pkField = `${tableName}.${this.object.PK()}`;

         query
            .eager("")
            .clearSelect()
            .countDistinct(`${pkField} as count`)
            .whereNotNull(pkField)
            .first()
            .then((data) => {
               // data = { count: 0 }
               // we just want to return the #
               resolve(data.count);
            })
            .catch((error) => {
               // populate any error messages with the SQL of this
               // query:
               error._sql = query.toString();
               reject(error);
            });
      });
   }

   /**
    * @method update
    * performs an update operation
    * @param {string} id
    *		the primary key for this update operation.
    * @param {obj} values
    *		A hash of the new values for this entry.
    * @param {Knex.Transaction?} trx - [optional]
    *
    * @return {Promise} resolved with the result of the find()
    */
   update(id, values, userData, trx = null) {
      let updateParams = this.object.requestParams(values);
      // {valueHash} updateParams
      // return the parameters from the input params that relate to this object
      // exclude connectObject data field values

      let updateRelationParams = this.object.requestRelationParams(values);
      // {valueHash} updateRelationParams
      // return the parameters of connectObject data field values

      let transParams = this.AB.cloneDeep(updateParams.translations);
      // {array} transParams
      // get translations values for the external object
      // it will update to translations table after model values updated

      return new Promise((resolve, reject) => {
         // get a Knex Query Object
         let query = this.modelKnex().query();

         // Used by knex.transaction, the transacting method may be chained to any query and
         // passed the object you wish to join the query as part of the transaction for.
         if (trx) query = query.transacting(trx);

         var PK = this.object.PK();

         // update our value
         query
            .patch(updateParams)
            .where(PK, id)
            .then((returnVals) => {
               // track logging
               /*
//// TODO: transaction Logging:
            ABTrack.logUpdate({
               objectId: this.object.id,
               rowId: id,
               username: userData.username,
               data: Object.assign(
                  updateParams,
                  updateRelationParams,
                  transParams
               ),
            });
            */

               // create a new query when use same query, then new data are created duplicate
               let updateTasks = updateRelationValues(
                  this.AB,
                  this.object,
                  id,
                  updateRelationParams
               );

               // update translation of the external table
               if (this.object.isExternal || this.object.isImported)
                  updateTasks.push(
                     updateTranslationsValues(
                        this.AB,
                        this.object,
                        id,
                        transParams
                     )
                  );

               // updateTasks
               //    .reduce((promiseChain, currTask) => {
               //       return promiseChain.then(currTask);
               //    }, Promise.resolve([]))
               Promise.all(updateTasks)
                  // Query the new row to response to client
                  .then((values) => {
                     return this.findAll(
                        {
                           where: {
                              glue: "and",
                              rules: [
                                 {
                                    key: PK,
                                    rule: "equals",
                                    value: id,
                                 },
                              ],
                           },
                           offset: 0,
                           limit: 1,
                           populate: true,
                        },
                        userData
                     ).then((newItem) => {
                        let result = newItem[0];
                        resolve(result);
                     });
                  })
                  .catch((err) => {
                     reject(err);
                  });
            })
            .catch((error) => {
               // populate any error messages with the SQL of this
               // query:
               error._sql = query.toString();
               reject(error);
            });
      });
   }

   /**
    * @method relate()
    * connect an object to another object via it's defined relation.
    *
    * this operation is ADDITIVE. It only appends additional relations.
    *
    * @param {string} id
    *       the uuid of this object that is relating to these values
    * @param {string} field
    *       a reference to the object.fields() that we are connecting to
    *       can be either .uuid or .columnName
    * @param {array} values
    *       one or more values to create a connection to.
    *       these can be either .uuid values, or full {obj} values.
    * @param {Knex.Transaction?} trx - [optional]
    *
    * @return {Promise}
    */
   relate(id, fieldRef, value, trx = null) {
      function errorReturn(message) {
         var error = new Error(message);
         return Promise.reject(error);
      }
      if (typeof id == undefined)
         return errorReturn("ABModel.relate(): missing id");
      if (typeof fieldRef == undefined)
         return errorReturn("ABModel.relate(): missing fieldRef");
      if (typeof value == undefined)
         return errorReturn("ABModel.relate(): missing value");

      var abField = this.object.fields(
         (f) => f.id == fieldRef || f.columnName == fieldRef
      )[0];
      if (!abField)
         return errorReturn(
            "ABModel.relate(): unknown field reference[" + fieldRef + "]"
         );

      var dl = abField.datasourceLink;
      if (!dl)
         return errorReturn(
            `ABModel.relate(): provided field[${fieldRef}] could not resolve its object`
         );

      let indexField = abField.indexField;

      // M:N case
      if (
         abField.settings.linkType == "many" &&
         abField.settings.linkViaType == "many" &&
         (indexField == null || indexField.object.id != dl.id)
      ) {
         indexField = abField.indexField2;
      }

      var fieldPK = indexField ? indexField.columnName : dl.PK();

      var relationName = abField.relationName();

      // now parse the provided value param and create an array of
      // primaryKey entries for our abField:
      var useableValues = [];
      if (!Array.isArray(value)) value = [value];
      value.forEach((v) => {
         if (typeof v == "object") {
            var val = v[fieldPK];
            if (val) {
               useableValues.push(val);
            }
            // Q: is !val an error, or a possible null that can't
            // Q: should I kill things here and report an error?
         } else {
            useableValues.push(v);
         }
      });

      return new Promise((resolve, reject) => {
         this.modelKnex()
            .query()
            .findById(id)
            .then((objInstance) => {
               let relateQuery = objInstance
                  .$relatedQuery(relationName)
                  .alias(
                     "#column#_#relation#"
                        .replace("#column#", abField.columnName)
                        .replace("#relation#", relationName)
                  ) // FIX: SQL syntax error because alias name includes special characters
                  .relate(useableValues);

               // Used by knex.transaction, the transacting method may be chained to any query and
               // passed the object you wish to join the query as part of the transaction for.
               if (trx) relateQuery = relateQuery.transacting(trx);

               return relateQuery;
            })
            .then(resolve)
            .catch(reject);
      });
      // let objInstance = this.modelKnex()
      //    .query()
      //    .findById(id);
      // return objInstance.$relatedQuery(relationName).relate(useableValues);

      // let query = this.modelKnex().query();
      // return query
      //    .relatedQuery(relationName)
      //    .for(id)
      //    .relate(useableValues);
   }

   modelDefaultFields() {
      return {
         uuid: { type: "string" },
         created_at: {
            type: ["null", "string"],
            pattern: ABFieldDateTime.RegEx, // AppBuilder.rules.SQLDateTimeRegExp,
         },
         updated_at: {
            type: ["null", "string"],
            pattern: ABFieldDateTime.RegEx, // AppBuilder.rules.SQLDateTimeRegExp,
         },
         properties: { type: ["null", "object"] },
      };
   }

   /**
    * @method modelKnex()
    * return a Knex Model definition for interacting with the DB.
    * @return {KnexModel}
    */
   modelKnex() {
      var modelName = this.modelKnexReference(),
         tableName = this.object.dbTableName(true);

      if (!__ModelPool[modelName]) {
         var connectionName = this.object.isExternal
            ? this.object.connName
            : undefined;
         // var knex = ABMigration.connection(connectionName);
         // TODO: expand connections for External Objects
         var knex = this.AB.Knex.connection(connectionName);

         // Compile our jsonSchema from our DataFields
         // jsonSchema is only used by Objection.js to validate data before
         // performing an insert/update.
         // This does not DEFINE the DB Table.
         var jsonSchema = {
            type: "object",
            required: [],
            properties: this.modelDefaultFields(),
         };
         var currObject = this.object;
         var allFields = this.object.fields();
         allFields.forEach(function (f) {
            f.jsonSchemaProperties(jsonSchema.properties);
         });

         class MyModel extends Model {
            // Table name is the only required property.
            static get tableName() {
               return tableName;
            }

            static get idColumn() {
               return currObject.PK();
            }

            static get jsonSchema() {
               return jsonSchema;
            }

            // Move relation setup to below
            // static get relationMappings () {
            // }
         }

         // rename class name
         // NOTE: prevent cache same table in difference apps
         Object.defineProperty(MyModel, "name", { value: modelName });

         __ModelPool[modelName] = MyModel;

         // NOTE : there is relation setup here because prevent circular loop when get linked object.
         // have to define object models to __ModelPool[tableName] first
         __ModelPool[modelName].relationMappings = () => {
            return this.modelKnexRelation();
         };

         // bind knex connection to object model
         // NOTE : when model is bound, then relation setup will be executed
         __ModelPool[modelName] = __ModelPool[modelName].bindKnex(knex);
      }

      return __ModelPool[modelName];
   }

   modelKnexReference() {
      // remove special characters
      return this.object.id.replace(/[^a-zA-Z]/g, "");
   }

   modelKnexRelation() {
      var tableName = this.object.dbTableName(true);

      // Compile our relations from our DataFields
      var relationMappings = {};

      var connectFields = this.object.connectFields();

      // linkObject: '', // ABObject.id
      // linkType: 'one', // one, many
      // linkViaType: 'many' // one, many

      connectFields.forEach((f) => {
         // find linked object name
         var linkObject = this.object.AB.objects(
            (obj) => obj.id == f.settings.linkObject
         )[0];
         if (linkObject == null) return;

         var linkField = f.fieldLink;
         if (linkField == null) return;

         var linkModel = linkObject.model().modelKnex();
         var relationName = f.relationName();

         var LinkType = `${f.settings.linkType}:${f.settings.linkViaType}`;
         // {string} LinkType
         // represent the connection type as a string:
         // values: [ "one:one", "many:one", "one:many", "many:many" ]

         // 1:1
         if (LinkType == "one:one") {
            var sourceTable, targetTable, targetPkName, relation, columnName;

            if (f.settings.isSource == true) {
               sourceTable = tableName;
               targetTable = linkObject.dbTableName(true);
               targetPkName = linkObject.PK();
               relation = Model.BelongsToOneRelation;
               columnName = f.columnName;
            } else {
               sourceTable = linkObject.dbTableName(true);
               targetTable = tableName;
               targetPkName = this.object.PK();
               relation = Model.HasOneRelation;
               columnName = linkField.columnName;
            }

            relationMappings[relationName] = {
               relation: relation,
               modelClass: linkModel,
               join: {
                  // "{targetTable}.{primaryField}"
                  from: `${targetTable}.${targetPkName}`,

                  // "{sourceTable}.{field}"
                  to: `${sourceTable}.${columnName}`,
               },
            };
         }
         // M:N
         else if (LinkType == "many:many") {
            // get join table name
            var joinTablename = f.joinTableName(true),
               joinColumnNames = f.joinColumnNames(),
               sourceTableName,
               sourcePkName,
               targetTableName,
               targetPkName;

            sourceTableName = f.object.dbTableName(true);
            sourcePkName = f.object.PK();
            targetTableName = linkObject.dbTableName(true);
            targetPkName = linkObject.PK();

            // if (f.settings.isSource == true) {
            // 	sourceTableName = f.object.dbTableName(true);
            // 	sourcePkName = f.object.PK();
            // 	targetTableName = linkObject.dbTableName(true);
            // 	targetPkName = linkObject.PK();
            // }
            // else {
            // 	sourceTableName = linkObject.dbTableName(true);
            // 	sourcePkName = linkObject.PK();
            // 	targetTableName = f.object.dbTableName(true);
            // 	targetPkName = f.object.PK();
            // }

            relationMappings[relationName] = {
               relation: Model.ManyToManyRelation,
               modelClass: linkModel,
               join: {
                  // "{sourceTable}.{primaryField}"
                  from: `${sourceTableName}.${sourcePkName}`,

                  through: {
                     // "{joinTable}.{sourceColName}"
                     from: `${joinTablename}.${joinColumnNames.sourceColumnName}`,

                     // "{joinTable}.{targetColName}"
                     to: `${joinTablename}.${joinColumnNames.targetColumnName}`,
                  },

                  // "{targetTable}.{primaryField}"
                  to: `${targetTableName}.${targetPkName}`,
               },
            };
         }
         // 1:M
         else if (LinkType == "one:many") {
            relationMappings[relationName] = {
               relation: Model.BelongsToOneRelation,
               modelClass: linkModel,
               join: {
                  // "{sourceTable}.{field}"
                  from: `${tableName}.${f.columnName}`,

                  // "{targetTable}.{primaryField}"
                  to: `${linkObject.dbTableName(true)}.${linkObject.PK()}`,
               },
            };
         }
         // M:1
         else if (LinkType == "many:one") {
            relationMappings[relationName] = {
               relation: Model.HasManyRelation,
               modelClass: linkModel,
               join: {
                  // "{sourceTable}.{primaryField}"
                  from: `${tableName}.${this.object.PK()}`,

                  // "{targetTable}.{field}"
                  to: `${linkObject.dbTableName(true)}.${linkField.columnName}`,
               },
            };
         }
      });

      return relationMappings;
   }

   /**
    * queryConditions()
    * Step through each of our where conditions and register the proper
    * Knex query condition.
    * @param {Knex} query
    * @param {obj} where
    *    a QueryBuilder compatible condition object
    * @param {obj} userData
    *    The included user data for this request.
    */
   queryConditions(query, where, userData, req) {
      // Apply filters
      if (!_.isEmpty(where)) {
         if (req) {
            req.log(
               "ABModel.queryConditions(): .where condition:",
               JSON.stringify(where, null, 4)
            );
         }

         // @function parseCondition
         // recursive fn() to step through each of our provided conditions and
         // translate them into query.XXXX() operations.
         // @param {obj} condition  a QueryBuilder compatible condition object
         // @param {ObjectionJS Query} Query the query object to perform the operations.
         // @param {string} glue ["and" || "or"]- needs to set .orWhere or .where inside Grouping query of knex. https://github.com/knex/knex/issues/1254
         var parseCondition = (condition, Query, glue = "and") => {
            // 'have_no_relation' condition will be applied later
            if (condition == null || condition.rule == "have_no_relation")
               return;

            // FIX: some improper inputs:
            // if they didn't provide a .glue, then default to 'and'
            // current webix behavior, might not return this
            // so if there is a .rules property, then there should be a .glue:
            if (condition.rules) {
               condition.glue = condition.glue || "and";
            }

            // if this is a grouping condition, then decide how to group and
            // process our sub rules:
            if (condition.glue) {
               var nextCombineKey = "andWhere";
               if (condition.glue == "or") {
                  nextCombineKey = "orWhere";
               }

               Query[nextCombineKey](function () {
                  (condition.rules || []).forEach((r) => {
                     parseCondition(r, this, condition.glue || "and");
                  });
               });

               return;
            }

            // Convert field id to column name
            if (this.AB.rules.isUUID(condition.key)) {
               var field = this.object.fields((f) => {
                  return (
                     f.id == condition.key &&
                     (!condition.alias || f.alias == condition.alias)
                  );
               })[0];
               if (field) {
                  // convert field's id to column name
                  condition.key = "{prefix}.`{columnName}`"
                     .replace("{prefix}", field.dbPrefix())
                     .replace("{columnName}", field.columnName);

                  // if we are searching a multilingual field it is stored in translations so we need to search JSON
                  if (field.isMultilingual) {
                     // TODO: move to ABOBjectExternal.js
                     if (
                        !this.object.viewName && // NOTE: check if this object is a query, then it includes .translations already
                        (field.object.isExternal || field.object.isImported)
                     ) {
                        let transTable = field.object.dbTransTableName();

                        let prefix = "";
                        if (field.alias) {
                           prefix = "{alias}_Trans".replace(
                              "{alias}",
                              field.alias
                           );
                        } else {
                           prefix = "{databaseName}.{tableName}"
                              .replace(
                                 "{databaseName}",
                                 field.object.dbSchemaName()
                              )
                              .replace("{tableName}", transTable);
                        }

                        // update our condition key with the new prefix + columnName
                        condition.key = "{prefix}.{columnName}"
                           .replace("{prefix}", prefix)
                           .replace("{columnName}", field.columnName);

                        let languageWhere = '`{prefix}`.`language_code` = "{languageCode}"'
                           .replace("{prefix}", prefix)
                           .replace("{languageCode}", userData.languageCode);

                        if (glue == "or") Query.orWhereRaw(languageWhere);
                        else Query.whereRaw(languageWhere);
                     } else {
                        let transCol;
                        // If it is a query
                        if (this.object.viewName)
                           transCol = "`{prefix}.translations`";
                        else transCol = "{prefix}.translations";

                        transCol = transCol.replace(
                           "{prefix}",
                           field.dbPrefix().replace(/`/g, "")
                        );

                        condition.key = this.AB.Knex.connection(/* connectionName */).raw(
                           'JSON_UNQUOTE(JSON_EXTRACT(JSON_EXTRACT({transCol}, SUBSTRING(JSON_UNQUOTE(JSON_SEARCH({transCol}, "one", "{languageCode}")), 1, 4)), \'$."{columnName}"\'))'
                              .replace(/{transCol}/g, transCol)
                              .replace(/{languageCode}/g, userData.languageCode)
                              .replace(/{columnName}/g, field.columnName)
                        );
                     }
                  }

                  // if this is from a LIST, then make sure our value is the .ID
                  else if (
                     field.key == "list" &&
                     field.settings &&
                     field.settings.options &&
                     field.settings.options.filter
                  ) {
                     // NOTE: Should get 'id' or 'text' from client ??
                     var desiredOption = field.settings.options.filter(
                        (option) =>
                           option.id == condition.value ||
                           option.text == condition.value
                     )[0];
                     if (desiredOption) condition.value = desiredOption.id;
                  }

                  // DATE (not DATETIME)
                  else if (
                     field.key == "date" &&
                     condition.rule != "last_days" &&
                     condition.rule != "next_days"
                  ) {
                     condition.key = `DATE(${condition.key})`;
                     condition.value = `DATE("${condition.value}")`;
                  }

                  // Search string value of FK column
                  else if (
                     field.key == "connectObject" &&
                     [
                        "contains",
                        "not_contains",
                        "equals",
                        "not_equal",
                        "in",
                        "not_in",
                     ].indexOf(condition.rule) != -1
                  ) {
                     this.convertConnectFieldCondition(field, condition);
                  }
               }
            }

            // sails.log.verbose('... basic condition:', JSON.stringify(condition, null, 4));

            // We are going to use the 'raw' queries for knex becuase the '.'
            // for JSON searching is misinterpreted as a sql identifier
            // our basic where statement will be:
            var whereRaw = "{fieldName} {operator} {input}";

            // make sure a value is properly Quoted:
            function quoteMe(value) {
               return "'" + value + "'";
            }

            // remove fields from rules
            var fieldTypes = [
               "number_",
               "string_",
               "date_",
               "boolean_",
               "user_",
               "list_",
               "connectObject_",
            ];

            // convert QB Rule to SQL operation:
            var conversionHash = {
               equals: "=",
               not_equal: "<>",
               is_empty: "=",
               is_not_empty: "<>",
               greater: ">",
               greater_or_equal: ">=",
               less: "<",
               less_or_equal: "<=",
               greater_current: ">",
               greater_or_equal_current: ">=",
               less_current: "<",
               less_or_equal_current: "<=",
               last_days: "BETWEEN",
               next_days: "BETWEEN",
            };

            // normal field name:
            var columnName = condition.key;
            if (typeof columnName == "string") {
               // make sure to ` ` columnName (if it isn't our special '1' condition )
               // see Policy:ABModelConvertSameAsUserConditions  for when that is applied
               if (columnName != "1" && columnName.indexOf("`") == -1) {
                  // if columnName is  a  table.field  then be sure to `` each one individually
                  var parts = columnName.split(".");
                  for (var p = 0; p < parts.length; p++) {
                     parts[p] = "`" + parts[p] + "`";
                  }
                  columnName = parts.join(".");
               }

               // ABClassQuery:
               // If this is query who create MySQL view, then column name does not have `
               if (this.object.viewName) {
                  columnName = "`" + columnName.replace(/`/g, "") + "`";
               }
            }

            // remove the field type from the rule
            var rule = condition.rule;
            if (rule) {
               fieldTypes.forEach((f) => {
                  rule = rule.replace(f, "");
               });
            }
            condition.rule = rule;
            // basic case:  simple conversion
            var operator = conversionHash[condition.rule];
            var value = condition.value;

            // If a function, then ignore quote. like DATE('05-05-2020')
            if (!RegExp("^[A-Z]+[(].*[)]$").test(value)) {
               value = quoteMe(value);
            }

            // special operation cases:
            switch (condition.rule) {
               case "begins_with":
                  operator = "LIKE";
                  value = quoteMe(condition.value + "%");
                  break;

               case "not_begins_with":
                  operator = "NOT LIKE";
                  value = quoteMe(condition.value + "%");
                  break;

               case "contains":
                  operator = "LIKE";
                  value = quoteMe("%" + condition.value + "%");
                  break;

               case "not_contains":
                  operator = "NOT LIKE";
                  value = quoteMe("%" + condition.value + "%");
                  break;

               case "ends_with":
                  operator = "LIKE";
                  value = quoteMe("%" + condition.value);
                  break;

               case "not_ends_with":
                  operator = "NOT LIKE";
                  value = quoteMe("%" + condition.value);
                  break;

               case "between":
                  operator = "BETWEEN";
                  value = condition.value
                     .map(function (v) {
                        return quoteMe(v);
                     })
                     .join(" AND ");
                  break;

               case "not_between":
                  operator = "NOT BETWEEN";
                  value = condition.value
                     .map(function (v) {
                        return quoteMe(v);
                     })
                     .join(" AND ");
                  break;

               case "is_current_user":
                  operator = "=";
                  value = quoteMe(userData.username);
                  break;

               case "is_not_current_user":
                  operator = "<>";
                  value = quoteMe(userData.username);
                  break;

               case "contain_current_user":
                  columnName = `JSON_SEARCH(JSON_EXTRACT(${columnName}, '$[*].id'), 'one', '${userData.username}')`;
                  operator = "IS NOT";
                  value = "NULL";
                  break;

               case "not_contain_current_user":
                  columnName = `JSON_SEARCH(JSON_EXTRACT(${columnName}, '$[*].id'), 'one', '${userData.username}')`;
                  operator = "IS";
                  value = "NULL";
                  break;

               case "is_null":
                  operator = "IS NULL";
                  value = "";
                  break;

               case "is_not_null":
                  operator = "IS NOT NULL";
                  value = "";
                  break;

               case "in":
                  operator = "IN";

                  // If condition.value is MySQL query command - (SELECT .. FROM ?)
                  if (
                     typeof condition.value == "string" &&
                     RegExp("^[(].*[)]$").test(condition.value)
                  ) {
                     value = condition.value;
                  }
                  // if we wanted an IN clause, but there were no values sent, then we
                  // want to make sure this condition doesn't return anything
                  else if (
                     Array.isArray(condition.value) &&
                     condition.value.length > 0
                  ) {
                     value =
                        "(" +
                        condition.value
                           .map(function (v) {
                              return quoteMe(v);
                           })
                           .join(", ") +
                        ")";
                  } else {
                     // send a false by resetting the whereRaw to a fixed value.
                     // any future attempts to replace this will be ignored.
                     whereRaw = " 1=0 ";
                  }
                  break;

               case "not_in":
                  operator = "NOT IN";

                  // If condition.value is MySQL query command - (SELECT .. FROM ?)
                  if (
                     typeof condition.value == "string" &&
                     RegExp("^[(].*[)]$").test(condition.value)
                  ) {
                     value = condition.value;
                  }
                  // if we wanted a NOT IN clause, but there were no values sent, then we
                  // want to make sure this condition returns everything (not filtered)
                  else if (
                     Array.isArray(condition.value) &&
                     condition.value.length > 0
                  ) {
                     value =
                        "(" +
                        condition.value
                           .map(function (v) {
                              return quoteMe(v);
                           })
                           .join(", ") +
                        ")";
                  } else {
                     // send a TRUE value so nothing gets filtered
                     whereRaw = " 1=1 ";
                  }
                  break;

               case "greater_current":
               case "greater_or_equal_current":
               case "less_current":
               case "less_or_equal_current":
                  value = "NOW()";
                  break;

               case "last_days":
                  value = `DATE_SUB(NOW(), INTERVAL ${condition.value} DAY) AND NOW()`;
                  break;
               case "next_days":
                  value = `NOW() AND DATE_ADD(NOW(), INTERVAL ${condition.value} DAY)`;
                  break;
            }

            // validate input
            if (columnName == null || operator == null) return;

            // // if we are searching a multilingual field it is stored in translations so we need to search JSON
            // if (field && field.settings.supportMultilingual == 1) {
            // 	fieldName = ('JSON_UNQUOTE(JSON_EXTRACT(JSON_EXTRACT({tableName}.translations, SUBSTRING(JSON_UNQUOTE(JSON_SEARCH({tableName}.translations, "one", "{languageCode}")), 1, 4)), \'$."{columnName}"\'))')
            // 					.replace(/{tableName}/g, field.object.dbTableName(true))
            // 					.replace(/{languageCode}/g, userData.languageCode)
            // 					.replace(/{columnName}/g, field.columnName);
            // }

            // // if this is from a LIST, then make sure our value is the .ID
            // if (field && field.key == "list" && field.settings && field.settings.options && field.settings.options.filter) {
            //     // NOTE: Should get 'id' or 'text' from client ??
            //     var inputID = field.settings.options.filter(option => (option.id == value || option.text == value))[0];
            //     if (inputID)
            //         value = inputID.id;
            // }

            // update our where statement:
            if (columnName && operator) {
               whereRaw = whereRaw
                  .replace("{fieldName}", columnName)
                  .replace("{operator}", operator)
                  .replace("{input}", value != null ? value : "");

               // Now we add in our where
               if (glue == "or") Query.orWhereRaw(whereRaw);
               else Query.whereRaw(whereRaw);
            }
         };

         parseCondition(where, query);

         // Special Case:  'have_no_relation'
         // 1:1 - Get rows that no relation with
         var noRelationRules = (where.rules || []).filter(
            (r) => r.rule == "have_no_relation"
         );
         noRelationRules.forEach((r) => {
            // var relation_name = AppBuilder.rules.toFieldRelationFormat(field.columnName);

            // var objectLink = field.objectLink();
            // if (!objectLink) return;

            // Query
            // 	.leftJoinRelation(relation_name)
            // 	.whereRaw('{relation_name}.{primary_name} IS NULL'
            // 		.replace('{relation_name}', relation_name)
            // 		.replace('{primary_name}', objectLink.PK()));

            // {
            //	key: "COLUMN_NAME", // no need to include object name
            //	rule: "have_no_relation",
            //	value: "LINK_OBJECT_PK_NAME"
            // }

            var field = this.object.fields((f) => f.id == r.key)[0];

            var relation_name = this.AB.rules.toFieldRelationFormat(
               field.columnName
            );

            var objectLink = field.datasourceLink;
            if (!objectLink) return;

            r.value = objectLink.PK();

            query.leftJoinRelation(relation_name).whereRaw(
               // "{relation_name}.{primary_name} IS NULL"
               `${relation_name}.${r.value} IS NULL`
            );
         });
      }
   } // queryConditions()

   /**
    * queryPopulate();
    * tell our populate our connected fields.
    * @param {Knex} query
    * @param {bool | array} populate
    *    Are we supposed to populate the connected fields?
    *    false : to not populate any fields
    *    true  : to populate all fields
    *    [ field.columnName, ... ]: to populate specific fields
    */
   queryPopulate(query, populate) {
      // query relation data
      if (query.withGraphFetched) {
         var relationNames = [];
         if (populate) {
            this.object
               .connectFields()
               .filter((f) => {
                  return (
                     (populate === true ||
                        populate.indexOf(f.columnName) > -1) &&
                     f.fieldLink != null
                  );
               })
               .forEach((f) => {
                  let relationName = f.relationName();

                  // Exclude .id column by adding (unselectId) function name to .withGraphFetched()
                  if (f.datasourceLink && f.datasourceLink.PK() === "uuid") {
                     relationName += "(unselectId)";
                  }

                  relationNames.push(relationName);

                  // Get translation data of External object
                  if (
                     f.datasourceLink &&
                     f.datasourceLink.transColumnName &&
                     (f.datasourceLink.isExternal ||
                        f.datasourceLink.isImported)
                  )
                     relationNames.push(f.relationName() + ".[translations]");
               });
         }

         // Include any translations connections from external/imported objects
         if (
            !this.object.viewName &&
            (this.object.isExternal || this.object.isImported) &&
            this.object.transColumnName
         ) {
            relationNames.push("translations");
         }

         // if (relationNames.length > 0) console.log(relationNames);
         query.withGraphFetched(`[${relationNames.join(", ")}]`).modifiers({
            // if the linked object's PK is uuid, then exclude .id
            unselectId: (builder) => {
               builder.omit(["id"]);
            },
         });

         // Exclude .id column
         if (this.object.PK() === "uuid") query.omit(this.modelKnex(), ["id"]);
      }
   }

   /**
    * querySort();
    * tell our query to sort according to the provided .sort fields.
    * @param {Knex} query
    * @param {array} sort
    *    Any included sort parameters that might include a multilingual field.
    * @param {obj} userData
    *    The included user data for this request.
    */
   querySort(query, sort, userData) {
      if (!_.isEmpty(sort)) {
         sort.forEach((o) => {
            var orderField = this.object.fields((f) => f.id == o.key)[0];
            if (!orderField) return;

            // if we are ordering by a multilingual field it is stored in translations so we need to search JSON but this is different from filters
            // because we are going to sort by the users language not the builder's so the view will be sorted differntly depending on which languageCode
            // you are using but the intent of the sort is maintained
            var sortClause = "";
            if (orderField.settings.supportMultilingual == 1) {
               // TODO: move to ABOBjectExternal.js
               if (
                  !this.object.viewName && // NOTE: check if this object is a query, then it includes .translations already
                  (orderField.object.isExternal || orderField.object.isImported)
               ) {
                  let prefix = "";
                  if (orderField.alias) {
                     prefix = orderField.alias;
                  } else {
                     // `{databaseName}.{tableName}`
                     prefix = `${orderField.object.dbSchemaName()}.${orderField.object.dbTransTableName()}`;
                  }

                  sortClause = "`{prefix}.translations`".replace(
                     "{prefix}",
                     prefix
                  );
               } else {
                  sortClause = 'JSON_UNQUOTE(JSON_EXTRACT(JSON_EXTRACT({prefix}.`translations`, SUBSTRING(JSON_UNQUOTE(JSON_SEARCH({prefix}.`translations`, "one", "{languageCode}")), 1, 4)), \'$."{columnName}"\'))'
                     .replace(/{prefix}/g, orderField.dbPrefix())
                     .replace("{languageCode}", userData.languageCode)
                     .replace("{columnName}", orderField.columnName);
               }
            }
            // If we are just sorting a field it is much simpler
            else {
               sortClause = "{prefix}.`{columnName}`"
                  .replace("{prefix}", orderField.dbPrefix())
                  .replace("{columnName}", orderField.columnName);

               // ABClassQuery:
               // If this is query who create MySQL view, then column name does not have `
               if (this.object.viewName) {
                  sortClause = "`" + sortClause.replace(/`/g, "") + "`";
               }
            }
            query.orderByRaw(sortClause + " " + o.dir);
         });
      }
   }

   /**
    * queryIncludeExternalMultilingualFields();
    * helper to ensure multilingual data from external tables are also included
    * in our results.
    * @param {Knex} query
    * @param {obj} where
    *    The where condition in QueryBuilder format. eg:
    *    {
    *      glue:"xxx",
    *      rules:[]
    *    }
    * @param {array} sort
    *    Any included sort parameters that might include a multilingual field.
    */
   queryIncludeExternalMultilingualFields(query, where, sort) {
      // Special case
      if (!this.object.viewName) {
         // NOTE: check if this object is a query, then it includes .translations already
         var multilingualFields = this.object.fields(
            (f) =>
               f.isMultilingual && (f.object.isExternal || f.object.isImported)
         );
         multilingualFields.forEach((f) => {
            let whereRules = where.rules || [];
            let sortRules = sort || [];

            if (
               whereRules.filter((r) => r.key == f.id)[0] ||
               (sortRules.filter && sortRules.filter((o) => o.key == f.id)[0])
            ) {
               let transTable = f.object.dbTransTableName();

               let prefix = "";
               let prefixTran = "";
               let tableTran = "";
               if (f.alias) {
                  prefix = "{alias}".replace("{alias}", f.alias);
                  prefixTran = "{alias}_Trans".replace("{alias}", f.alias);
                  tableTran = "{tableName} AS {alias}"
                     .replace("{tableName}", f.object.dbTransTableName(true))
                     .replace("{alias}", prefixTran);
               } else {
                  prefix = "{databaseName}.{tableName}"
                     .replace("{databaseName}", f.object.dbSchemaName())
                     .replace("{tableName}", f.object.dbTableName());
                  prefixTran = "{databaseName}.{tableName}"
                     .replace("{databaseName}", f.object.dbSchemaName())
                     .replace("{tableName}", transTable);
                  tableTran = f.object.dbTransTableName(true);
               }

               let baseClause = "{prefix}.{columnName}"
                     .replace("{prefix}", prefix)
                     .replace("{columnName}", f.object.PK()),
                  connectedClause = "{prefix}.{columnName}"
                     .replace("{prefix}", prefixTran)
                     .replace("{columnName}", f.object.transColumnName);

               if (
                  !(query._statements || []).filter(
                     (s) => s.table == transTable
                  ).length
               )
                  // prevent join duplicate
                  query.innerJoin(tableTran, baseClause, "=", connectedClause);
            }
         });
      }
   }

   /**
    * querySelectFormulaFields()
    * Make sure our query properly selects any Formulas for our fomula fields.
    *
    * Formula selects should look like:
    * (SELECT SUM(field) FROM table WHERE table.column = this.value) AS columnName
    *
    * @param {Knex} query
    *    the KenxQueryBuilder that is building our sql query.  We add the selects
    *    onto this query builder using query.select()
    */
   querySelectFormulaFields(query, userData) {
      let raw = this.AB.Knex.connection().raw;

      // Formula fields
      let formulaFields = this.object.fields((f) => f.key == "formula");
      (formulaFields || []).forEach((f) => {
         let selectSQL = this.convertFormulaField(f, userData);
         if (selectSQL) {
            // selectSQL += ` AS ${this.dbTableName(true)}.${f.columnName}`;
            selectSQL += ` AS \`${f.columnName}\``;
            query = query.select(raw(selectSQL));
         }
      });

      // NOTE: select all columns
      if (formulaFields.length)
         query = query.select(`${this.object.dbTableName(true)}.*`);
   }

   /**
    * convertFormulaField()
    * Helper function to build the SELECT .. FROM ... WHERE ...  portion
    * of our Formula Field selects.
    *
    * @param {ABFieldFormula} formulaField
    *    the formula field we need to represent in the query
    * @return {string}
    *    the SQL select statement for the formula
    */
   convertFormulaField(formulaField, userData) {
      if (formulaField == null || formulaField.key != "formula") return "";

      let settings = formulaField.settings || {};

      let connectedField = this.object.fields((f) => f.id == settings.field)[0];
      if (!connectedField) return;

      let linkField = connectedField.fieldLink;
      if (!linkField) return;

      let connectedObj = this.AB.objectByID(settings.object);
      if (!connectedObj) return;

      let numberField = connectedObj.fields(
         (f) => f.id == settings.fieldLink
      )[0];
      if (!numberField) return;

      let selectSQL = "";
      let type = {
         sum: "SUM",
         average: "AVG",
         max: "MAX",
         min: "MIN",
         count: "COUNT",
      };

      // Generate where clause of formula field
      let whereClause = "";
      if (
         formulaField &&
         formulaField.settings &&
         formulaField.settings.where &&
         formulaField.settings.where.rules &&
         formulaField.settings.where.rules.length
      ) {
         let formulaFieldQuery = connectedObj.model().modelKnex().query();

         this.queryConditions(
            formulaFieldQuery,
            formulaField.settings.where,
            userData
         );

         let whereString = "";
         try {
            whereString = formulaFieldQuery.toString(); // select `DB_NAME`.`AB_TABLE_NAME`.* from `DB_NAME`.`AB_TABLE_NAME` where (`DB_NAME`.`AB_TABLE_NAME`.`COLUMN` LIKE '%VALUE%')

            // get only where clause
            let wherePosition = whereString.indexOf("where");
            whereString = whereString.substring(
               wherePosition + 5,
               whereString.length
            ); // It should be (`DB_NAME`.`AB_TABLE_NAME`.`COLUMN` LIKE '%VALUE%')

            if (whereString) whereClause = ` AND ${whereString}`;
         } catch (e) {}
      }

      var LinkType = `${connectedField.settings.linkType}:${connectedField.settings.linkViaType}`;
      // {string} LinkType
      // represent the connection type as a string:
      // values: [ "one:one", "many:one", "one:many", "many:many" ]

      // M:1 or ( 1:1 & ! source)
      if (
         LinkType == "many:one" ||
         (LinkType == "one:one" && !connectedField.settings.isSource)
      ) {
         selectSQL = `(SELECT IFNULL(${type[settings.type]}(\`${
            numberField.columnName
         }\`), 0)
                  FROM ${connectedObj.dbTableName(true)}
                  WHERE ${connectedObj.dbTableName(true)}.\`${
            linkField.columnName
         }\` = ${this.object.dbTableName(true)}.\`${
            connectedField.indexField
               ? connectedField.indexField.columnName
               : this.object.PK()
         }\` ${whereClause})`;
      }
      // 1:M , 1:1 & source
      else if (
         LinkType == "one:many" ||
         (LinkType == "one:one" && connectedField.settings.isSource)
      ) {
         selectSQL = `(SELECT IFNULL(${type[settings.type]}(\`${
            numberField.columnName
         }\`), 0)
                  FROM ${connectedObj.dbTableName(true)}
                  WHERE ${connectedObj.dbTableName(true)}.\`${
            connectedField.indexField
               ? connectedField.indexField.columnName
               : connectedObj.PK()
         }\` = ${this.object.dbTableName(true)}.\`${
            connectedField.columnName
         }\` ${whereClause})`;
      }
      // M:N
      else if (LinkType == "many:many") {
         let joinTable = connectedField.joinTableName(true),
            joinColumnNames = connectedField.joinColumnNames();

         selectSQL = `(SELECT IFNULL(${type[settings.type]}(\`${
            numberField.columnName
         }\`), 0)
               FROM ${connectedObj.dbTableName(true)}
               INNER JOIN ${joinTable}
               ON ${joinTable}.\`${
            joinColumnNames.targetColumnName
         }\` = ${connectedObj.dbTableName(true)}.${connectedObj.PK()}
               WHERE ${joinTable}.\`${
            joinColumnNames.sourceColumnName
         }\` = ${this.object.dbTableName(
            true
         )}.\`${this.object.PK()}\` ${whereClause})`;
      }

      return selectSQL;
   }

   /**
    * convertConnectFieldCondition()
    * A helper function to decode a condition that attempts to see if a
    * connected field either contains/not contains/equals/not equals a given
    * value.
    * @param {ABDataFieldConnect} field
    *    The connection this condition is based upon.
    * @param {obj} condition
    *    The condition rule we are updating:
    *    condition.key : {string} needs to contain the sql field reference
    *    condition.rule: {string} needs to contain the sql comparison value
    *    condition.value: {string} needs to contain the sql value check
    */
   convertConnectFieldCondition(field, condition) {
      let getCustomKey = (f, fCustomIndex) => {
         return "{prefix}.`{columnName}`"
            .replace("{prefix}", f.dbPrefix())
            .replace(
               "{columnName}",
               fCustomIndex ? fCustomIndex.columnName : f.object.PK()
            );
      };

      var LinkType = `${field.settings.linkType}:${field.settings.linkViaType}`;
      // {string} LinkType
      // represent the connection type as a string:
      // values: [ "one:one", "many:one", "one:many", "many:many" ]

      // M:1 or 1:1 (isSource == false)
      if (
         LinkType === "many:one" ||
         (LinkType === "one:one" && !field.settings.isSource)
      ) {
         condition.key = getCustomKey(field, field.indexField);
      }
      // M:N
      else if (LinkType === "many:many") {
         // find custom index field
         let customIndexField;
         if (
            field.indexField &&
            field.indexField.object.id == field.object.id
         ) {
            customIndexField = field.indexField;
         } else if (
            field.indexField2 &&
            field.indexField2.object.id == field.object.id
         ) {
            customIndexField = field.indexField2;
         }

         // update condition.key is PK or CustomFK
         condition.key = getCustomKey(field, customIndexField);

         let fieldLink = field.fieldLink;
         if (!fieldLink) {
            // Already Notifid by here, so:
            // if unable to resolve fieldLink how do we exit gracefully?
            condition.key = "1";
            condition.value = "0";
            condition.rule = "equals";
            return;
         }

         let joinTable = field.joinTableName();
         let sourceFkName = field.object.name;
         let targetFkName = fieldLink.object.name;

         let mnOperators = {
            contains: "LIKE",
            not_contains: "LIKE", // not NOT LIKE because we will use IN or NOT IN at condition.rule instead
            equals: "=",
            not_equal: "=", // same .not_contains
            in: "IN",
            not_in: "NOT IN",
         };

         var rawSelect =
            "(SELECT `{sourceFkName}` FROM `{joinTable}` WHERE `{targetFkName}` {ops} {quote}{percent}{value}{percent}{quote})";

         // if this is an IN statement, repackage our [values] to proper SQL form:
         if (condition.rule == "in" || condition.rule == "not_in") {
            if (Array.isArray(condition.value)) {
               var sqlVal = condition.value
                  .map((v) => (isNaN(v) ? `'${v}'` : v))
                  .join(", ");

               condition.value = `( ${sqlVal} )`;
            }

            // we don't quote the IN series
            rawSelect = rawSelect.replaceAll("{quote}", "");
         } else {
            // all others get quoted
            rawSelect = rawSelect.replaceAll("{quote}", "'");
         }

         // create sub-query to get values from MN table
         condition.value = rawSelect
            .replace("{sourceFkName}", sourceFkName)
            .replace("{joinTable}", joinTable)
            .replace("{targetFkName}", targetFkName)
            .replace("{ops}", mnOperators[condition.rule])
            .replace("{value}", condition.value);

         condition.value =
            condition.rule == "contains" || condition.rule == "not_contains"
               ? condition.value.replace(/{percent}/g, "%")
               : condition.value.replace(/{percent}/g, "");

         condition.rule =
            ["contains", "equals", "in"].indexOf(condition.rule) == -1
               ? "in"
               : "not_in";
      }
   }
};

/************************
 *** Update() Helpers ***
 ************************/

/**
 * clearRelate()
 * clear the relations on the provided obj[columnName]
 * @param {ABObject} obj
 * @param {string} columnName
 *        the column name of the relations we are clearing.
 * @param {string} rowId
 *        the .uuid of the row we are working on.
 * @return {Promise}
 */
function clearRelate(obj, columnName, rowId) {
   return new Promise((resolve, reject) => {
      // WORKAROUND : HRIS tables have non null columns
      if (obj.isExternal) return resolve();

      // create a new query to update relation data
      // NOTE: when use same query, it will have a "created duplicate" error
      let query = obj.model().modelKnex().query();

      let clearRelationName = AB.rules.toFieldRelationFormat(columnName);

      query
         .where(obj.PK(), rowId)
         .first()
         .then((record) => {
            if (record == null) return resolve();

            let fieldLink = obj.fields((f) => f.columnName == columnName)[0];
            if (fieldLink == null) return resolve();

            let objectLink = fieldLink.object;
            if (objectLink == null) return resolve();

            record
               .$relatedQuery(clearRelationName)
               .alias(`${columnName}_${clearRelationName}`)
               .unrelate()
               .then(() => {
                  resolve();
               })
               .catch((err) => reject(err));
         })
         .catch((err) => reject(err));
   });
}

/**
 * setRelate()
 * set a relationship between obj[columnName] and value
 * @param {ABObject} obj
 * @param {string} columnName
 *        the column name of the relations we are clearing.
 * @param {string} rowId
 *        the .uuid of the row we are working on.
 * @param {valueHash} value
 *        the new value we are establishing a relation to.
 * @return {Promise}
 */
function setRelate(obj, columnName, rowId, value) {
   return new Promise((resolve, reject) => {
      // create a new query to update relation data
      // NOTE: when use same query, it will have a "created duplicate" error
      let query = obj.model().modelKnex().query();

      let relationName = AB.rules.toFieldRelationFormat(columnName);

      query
         .where(obj.PK(), rowId)
         .first()
         .then((record) => {
            if (record == null) return resolve();

            record
               .$relatedQuery(relationName)
               .alias(`${columnName}_${relationName}`)
               .relate(value)
               .then(() => {
                  resolve();
               })
               .catch((err) => reject(err));
         })
         .catch((err) => reject(err));
   });
}

/**
 * @function updateRelationValues()
 * Make sure an object's relationships are properly updated.
 * We expect that when a create or update happens, that the data in the
 * related fields represent the CURRENT STATE of all it's relations. Any
 * field not in the relation value is no longer part of the related data.
 * @param {ABFactory} AB
 * @param {ABObject} object
 * @param {integer} id
 *        the .id of the base object we are working with
 * @param {obj} updateRelationParams
 *        "key"=>"value" hash of the related fields and current state of
 *        values.
 * @return {array}  array of update operations to perform the relations.
 */
function updateRelationValues(AB, object, id, updateRelationParams) {
   var updateTasks = [];
   // {array} updateTasks
   // an array of the {Promise}s that are performing the updates.

   ////
   //// We are given a current state of values that should be related to our object.
   //// It is not clear if these are new relations or existing ones, so we first
   //// remove any existing relation and then go back and add in the one we have been
   //// told to keep.
   ////

   // NOTE : There is a error when update values and foreign keys at same time
   // - Error: Double call to a write method. You can only call one of the write methods
   // - (insert, update, patch, delete, relate, unrelate, increment, decrement)
   //    and only once per query builder
   if (
      updateRelationParams != null &&
      Object.keys(updateRelationParams).length > 0
   ) {
      // update relative values
      Object.keys(updateRelationParams).forEach((colName) => {
         // SPECIAL CASE: 1-to-1 relation self join,
         // Need to update linked data
         let field = object.fields((f) => f.columnName == colName)[0];
         if (
            field &&
            field.settings.linkObject == object.id &&
            field.settings.linkType == "one" &&
            field.settings.linkViaType == "one" &&
            !object.isExternal
         ) {
            let sourceField = field.settings.isSource ? field : field.fieldLink;
            if (sourceField == null) return resolve();

            let relateRowId = null;
            if (updateRelationParams[colName])
               // convert to int
               relateRowId = parseInt(updateRelationParams[colName]);

            // clear linked data
            updateTasks.push(() => {
               return new Promise((resolve, reject) => {
                  let update = {};
                  update[sourceField.columnName] = null;

                  let query = object.model().modelKnex().query();
                  query
                     .update(update)
                     .clearWhere()
                     .where(object.PK(), id)
                     .orWhere(object.PK(), relateRowId)
                     .orWhere(sourceField.columnName, id)
                     .orWhere(sourceField.columnName, relateRowId)
                     .then(() => {
                        resolve();
                     })
                     .catch((err) => reject(err));
               });
            });

            // set linked data
            if (updateRelationParams[colName]) {
               updateTasks.push(() => {
                  return new Promise((resolve, reject) => {
                     let update = {};
                     update[sourceField.columnName] = relateRowId;

                     let query = object.model().modelKnex().query();
                     query
                        .update(update)
                        .clearWhere()
                        .where(object.PK(), id)
                        .then(() => {
                           resolve();
                        })
                        .catch((err) => reject(err));
                  });
               });

               updateTasks.push(() => {
                  return new Promise((resolve, reject) => {
                     let update = {};
                     update[sourceField.columnName] = id;

                     let query = object.model().modelKnex().query();
                     query
                        .update(update)
                        .clearWhere()
                        .where(object.PK(), relateRowId)
                        .then(() => {
                           resolve();
                        })
                        .catch((err) => reject(err));
                  });
               });
            }
         }

         // Normal relations
         else {
            let needToClear = true;

            // If link column is in the table, then will not need to clear connect data
            if (
               updateRelationParams[colName] &&
               field &&
               field.settings &&
               // 1:M
               ((field.settings.linkType == "one" &&
                  field.settings.linkViaType == "many") ||
                  // 1:1 isSource = true
                  (field.settings.linkType == "one" &&
                     field.settings.linkViaType == "one" &&
                     field.settings.isSource))
            ) {
               needToClear = false;
            }

            // Clear relations
            if (needToClear) {
               updateTasks.push(() => clearRelate(object, colName, id));
            }

            // convert relation data to array
            if (!Array.isArray(updateRelationParams[colName])) {
               updateRelationParams[colName] = [updateRelationParams[colName]];
            }

            // We could not insert many relation values at same time
            // NOTE : Error: batch insert only works with Postgresql
            updateRelationParams[colName].forEach((val) => {
               // insert relation values of relation
               updateTasks.push(() => {
                  return setRelate(object, colName, id, val);
               });
            });
         }
      });
   }

   return updateTasks;
}

/**
 * @function updateTranslationsValues
 * Update translations value of the external table.  These are a legacy table
 * structure that allowed tables to track their multilingual fields in a
 * separate translation table.
 * @param {ABFactory} AB
 * @param {ABObject} object
 * @param {int} id
 * @param {Array} translations - translations data
 * @param {boolean} isInsert
 *
 */
function updateTranslationsValues(AB, object, id, translations, isInsert) {
   if (!object.isExternal || !object.isImported) return Promise.resolve();

   let transModel = object.model().modelKnex().relationMappings()[
      "translations"
   ];
   if (!transModel) return Promise.resolve();

   let tasks = [],
      transTableName = transModel.modelClass.tableName;
   multilingualFields = object.fields((f) => f.settings.supportMultilingual);

   (translations || []).forEach((trans) => {
      tasks.push(
         new Promise((next, err) => {
            let transKnex = AB.Knex.connection()(transTableName);

            // values
            let vals = {};
            vals[object.transColumnName] = id;
            vals["language_code"] = trans["language_code"];

            multilingualFields.forEach((f) => {
               vals[f.columnName] = trans[f.columnName];
            });

            // where clause
            let where = {};
            where[object.transColumnName] = id;
            where["language_code"] = trans["language_code"];

            // insert
            if (isInsert) {
               transKnex
                  .insert(vals)
                  .then(function () {
                     next();
                  })
                  .catch(err);
            }
            // update
            else {
               Promise.resolve()
                  .then(() => {
                     // NOTE: There is a bug to update TEXT column of federated table
                     // https://bugs.mysql.com/bug.php?id=63446
                     // WORKAROUND: first update the cell to NULL and then update it again
                     return new Promise((resolve, reject) => {
                        var longTextFields = multilingualFields.filter(
                           (f) => f.key == "LongText"
                        );
                        if (longTextFields.length < 1) return resolve();

                        var clearVals = {};

                        longTextFields.forEach((f) => {
                           clearVals[f.columnName] = null;
                        });

                        transKnex
                           .update(clearVals)
                           .where(where)
                           .then(resolve)
                           .catch(reject);
                     });
                  })
                  .then(() => {
                     return new Promise((resolve, reject) => {
                        transKnex
                           .update(vals)
                           .where(where)
                           .then(resolve)
                           .catch(reject);
                     });
                  })
                  .then(next)
                  .catch(err);
            }
         })
      );
   });

   return Promise.all(tasks);
}
