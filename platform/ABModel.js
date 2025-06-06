const ABModelCore = require("../core/ABModelCore");
const { Model, raw } = require("objection");

const ABFieldDateTime = require("../core/dataFields/ABFieldDateTimeCore");

const _ = require("lodash");

// var __ModelPool = {};
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
    * @param {ABUtil.reqService} req
    *    The request object associated with the current tenant/request
    * @return {Promise} resolved with the result of the find()
    */
   create(values, trx = null, condDefaults = null, req = null) {
      // make sure we ONLY have valid field values in {values}
      var baseValues = this.object.requestParams(values);
      var addRelationParams = this.object.requestRelationParams(values);

      // make sure a UUID is set
      var PK = this.object.PK();
      // Keep the passed in uuid if provided.
      if (PK === "uuid" && values[PK]) {
         baseValues[PK] = values[PK];
      }
      // if not, create a uuid
      if (PK === "uuid" && baseValues[PK] == null) {
         baseValues[PK] = this.AB.uuid();
      }

      // created_at & updated_at
      var date = this.AB.rules.toSQLDateTime(new Date());
      baseValues["created_at"] = baseValues["created_at"] || date;
      baseValues["updated_at"] = baseValues["updated_at"] || date;

      let validationErrors = this.object.isValidData(baseValues);
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
            .insert(baseValues)
            .then((returnVals) => {
               if (req) {
                  req.log(
                     `${
                        this.object.label || this.object.name
                     }.create() successful. Now loading full value from DB.`
                  );
               }
               if (returnVals) {
                  var relateTasks = [];
                  // {array}
                  // all the fn() calls that need to be performed to relate a task.

                  for (var colName in addRelationParams) {
                     let newVals = addRelationParams[colName];
                     if (!Array.isArray(newVals)) {
                        newVals = [newVals];
                     }

                     let fPK = "uuid";
                     let field = this.object.fields(
                        (f) => f.columnName == colName
                     )[0];
                     if (field) {
                        let objectLink = field.datasourceLink;
                        if (objectLink) {
                           fPK = objectLink.PK();
                        }
                     }

                     newVals = newVals
                        .filter((v) => v !== null)
                        .map((v) => v[fPK] || v.id || v.uuid || v);

                     // relateTasks.push(() =>
                     //    this.relate(returnVals[PK], colName, newVals, trx, req)
                     // );
                     AddToRelateTasks(
                        relateTasks,
                        this.object,
                        colName,
                        returnVals[PK],
                        newVals,
                        trx,
                        req
                     );
                  }
               }

               doSequential(relateTasks, (err) => {
                  if (err) {
                     return reject(err);
                  }

                  // no insert row
                  if (returnVals == null) {
                     resolve(null);
                     return;
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
               });
            })
            .catch((error) => {
               // populate any error messages with the SQL of this
               // query:
               try {
                  error._sql = query.toKnexQuery().toSQL().sql;
               } catch (e) {
                  error._sql = "??";
               }
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
               try {
                  error._sql = query.toKnexQuery().toSQL().sql;
               } catch (e) {
                  error._sql = "??";
               }
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
            // break;
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
               if (req && req.log) {
                  req.log(`.find() ${err.code} : retrying ...`);
               }
               return this.findAll(cond, userDefaults, req);
            }
            err.__context = err.__context || [];
            err.__context.push(".find().findAll().catch():throw err");
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
    * @param {ABUtil.reqService} req
    *    The request object associated with the current tenant/request
    * @return {Promise} resolved with the result of the find()
    */
   findAll(cond = {}, conditionDefaults, req) {
      cond = this.formatCondition(cond);

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
         this.queryConditions(query, cond.where, conditionDefaults, req);
         this.querySelectFormulaFields(query, conditionDefaults, req);
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

         // populate the data
         this.queryPopulate(query, cond.populate);

         // perform the operation
         query
            .then((data) => {
               if (cond?.disableMinifyRelation) {
                  this.normalizeData(data);
                  resolve(data);
               } else {
                  // reduce the data in our populated columns
                  return this.populateMin(data, cond.populate).then((data) => {
                     // normalize our Data before returning
                     this.normalizeData(data);
                     resolve(data);
                  });
               }
            })
            .catch((error) => {
               // populate any error messages with the SQL of this
               // query:
               try {
                  error._sql = query.toKnexQuery().toSQL().sql;
               } catch (e) {
                  console.error("Error trying to .sql() my query");
                  console.error(e);
               }
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
    * @param {ABUtil.reqService} req
    *    The request object associated with the current tenant/request
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
         this.queryConditions(query, cond.where, conditionDefaults, req);

         let pkField = `${tableName}.${this.object.PK()}`;

         query
            // .eager("")
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
               try {
                  error._sql = query.toKnexQuery().toSQL().sql;
               } catch (e) {
                  error._sql = "??";
               }
               reject(error);
            });
      });
   }

   formatCondition(cond) {
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

      return cond;
   }

   /**
    * @method update
    * performs an update operation
    * @param {string} id
    *   the primary key for this update operation.
    * @param {obj} values
    *   A hash of the new values for this entry.
    * @param {Knex.Transaction?} trx - [optional]
    *
    * @return {Promise} resolved with the result of the find()
    */
   async update(id, values, userData, trx = null, req = null) {
      id = id.id || id.uuid || id;
      // id should be just the .uuid or .id value of the row we are updating
      // but in case they sent in a condition obj: { uuid: 'xyz' } lets try to
      // de-reference it.

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

      let PK = this.object.PK();
      let findAllParams = {
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
      };
      // {obj} findAllParams
      // the .findAll() condition params to pull the current value of this obj
      // out of the DB.

      let oldValue = await this.findAll(findAllParams, userData);
      oldValue = oldValue[0];
      // {obj} oldValue
      // the current value of the entry in the DB.

      return new Promise((resolve, reject) => {
         // get a Knex Query Object
         let query = this.modelKnex().query();

         // Used by knex.transaction, the transacting method may be chained to any query and
         // passed the object you wish to join the query as part of the transaction for.
         if (trx) query = query.transacting(trx);

         if (req) {
            req.log("ABModel.update(): updating initial params:", updateParams);
            req.performance.mark("update-base");
         }

         // update our value
         query
            .patch(updateParams)
            .where(PK, id)
            .then((/* returnVals */) => {
               if (req) {
                  req.performance.measure("update-base");
                  req.performance.mark("update-relations");
                  req.log(
                     "ABModel.update(): updating relationships",
                     updateRelationParams
                  );
               }

               // create a new query when use same query, then new data are created duplicate
               let updateTasks = [];
               // {array} Promise
               // An array of the additional update operations being performed.  Each entry
               // should be a {Promise} of an operation.

               updateTasks.push(
                  updateRelationValues(
                     this.AB,
                     this.object,
                     id,
                     updateRelationParams,
                     oldValue,
                     trx,
                     req
                  )
               );

               // update translation of the external table
               // ## DEPRECIATED: LEGACY: this is an implementation designed to allow us
               // to work with the legacy HRIS tables.  In the future, we will have to
               // rework this to work with .isExternal or .isImported objects that are
               // NOT LEGACY tables.
               if (this.object.isExternal || this.object.isImported) {
                  updateTasks.push(
                     updateTranslationsValues(
                        this.AB,
                        this.object,
                        id,
                        transParams
                     )
                  );
               }

               Promise.all(updateTasks)
                  // Query the new row to response to client
                  .then((/* values */) => {
                     if (req) {
                        req.performance.measure("update-relations");
                        req.performance.mark("update-find-updated-entry");
                        req.log("ABModel.update(): finding return value");
                     }
                     return this.findAll(findAllParams, userData).then(
                        (newItem) => {
                           if (req) {
                              req.performance.measure(
                                 "update-find-updated-entry"
                              );
                           }
                           let result = newItem[0];
                           resolve(result);
                        }
                     );
                  })
                  .catch((err) => {
                     reject(err);
                  });
            })
            .catch((error) => {
               // populate any error messages with the SQL of this
               // query:
               try {
                  error._sql = query.toKnexQuery().toSQL().sql;
               } catch (e) {
                  error._sql = "??";
               }
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
    * @param {string} fieldRef
    *       a reference to the object.fields() that we are connecting to
    *       can be either .uuid or .columnName
    * @param {array} value
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
      if (typeof id == "undefined")
         return errorReturn("ABModel.relate(): missing id");
      if (typeof fieldRef == "undefined")
         return errorReturn("ABModel.relate(): missing fieldRef");
      if (typeof value == "undefined")
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
            let val = v[fieldPK] || v["id"] || v;
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
               doRelate(
                  useableValues,
                  objInstance,
                  relationName,
                  `${abField.columnName}_${relationName}`,
                  trx,
                  (err) => {
                     if (err) {
                        reject(err);
                     } else {
                        resolve();
                     }
                  }
               );
            })
            .catch(reject);
      });
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
    * @method modelKnexRefresh()
    * when the definitions of our objects change (dropping a field, adding a field)
    * we need to change the Knex Objection Model definition for this object.
    */
   modelKnexRefresh() {
      var modelName = this.modelKnexReference();
      this.AB.modelPoolDelete(modelName);
      // delete __ModelPool[modelName];

      var knex = this.AB.Knex.connection(this.object.connName);
      var tableName = this.object.dbTableName(true);

      if (knex.$$objection && knex.$$objection.boundModels) {
         // delete knex.$$objection.boundModels[tableName];

         // FIX : Knex Objection v.1.1.8
         knex.$$objection.boundModels.delete(tableName + "_" + modelName);
      }
   }

   /**
    * @method modelKnex()
    * return a Knex Model definition for interacting with the DB.
    * @return {KnexModel}
    */
   modelKnex() {
      var modelName = this.modelKnexReference(),
         tableName = this.object.dbTableName(true);

      // if (!__ModelPool[modelName]) {
      if (!this.AB.modelPool(modelName)) {
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

         // this.AB.modelPoolSet(modelName, MyModel);
         // __ModelPool[modelName] = MyModel;

         // NOTE : there is relation setup here because prevent circular loop
         // when get linked object. have to define object models to
         // __ModelPool[tableName] first
         // __ModelPool[modelName].relationMappings = () => {
         MyModel.relationMappings = () => {
            return this.modelKnexRelation();
         };

         // bind knex connection to object model
         // NOTE : when model is bound, then relation setup will be executed
         // eslint-disable-next-line no-class-assign  -- this is how it works
         MyModel = MyModel.bindKnex(knex);

         this.AB.modelPoolSet(modelName, MyModel);
      }

      // return __ModelPool[modelName];
      return this.AB.modelPool(modelName);
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
         var linkObject = this.object.AB.objectByID(f.settings.linkObject);
         if (linkObject == null) return;

         var linkField = f.fieldLink;
         if (linkField == null) return;

         var linkModel = linkObject.model().modelKnex?.();
         if (!linkModel) return;

         var relationName = f.relationName();

         var LinkType = `${f.settings.linkType}:${f.settings.linkViaType}`;
         // {string} LinkType
         // represent the connection type as a string:
         // values: [ "one:one", "many:one", "one:many", "many:many" ]

         // 1:1
         if (LinkType == "one:one") {
            // in a 1:1 relatiionship, we still store the data from 1 obj
            // into the data in another object.

            // we figure out which object is the one containing the data
            // to store, by the field's  .isSource setting.

            // if an .indexField is present in the connection settings, then
            // it references a column in the .isSource's object's table to use
            // for the value being stored. (otherwise we default to the .PK()
            // column)

            let sourceTable, targetTable, targetPkName, relation, columnName;

            if (f.settings.isSource == true) {
               sourceTable = tableName;
               targetTable = linkObject.dbTableName(true);
               targetPkName = f.indexField
                  ? f.indexField.columnName
                  : linkObject.PK();
               relation = Model.BelongsToOneRelation;
               columnName = f.columnName;
            } else {
               sourceTable = linkObject.dbTableName(true);
               targetTable = tableName;
               targetPkName = f.indexField
                  ? f.indexField.columnName
                  : this.object.PK();
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
            // in a M:N relatiionship, the connection data is managed via a
            // join table.

            // in this case .indexField  and/or  .indexField2 might be set.
            // these values track custom field keys for use in what data is
            // used to relate these values.

            // when the definition is created, the object where the connection
            // was created contains the .indexField field.  The linked object
            // contains the .indexField2 field.

            // get join table name
            // let joinTablename = f.joinTableName(true),
            //    joinColumnNames = f.joinColumnNames(),
            let sourceTableName, sourcePkName, targetTableName, targetPkName;

            sourceTableName = f.object.dbTableName(true);
            sourcePkName = f.object.PK();
            targetTableName = linkObject.dbTableName(true);
            targetPkName = linkObject.PK();

            // if the connection is based upon a custom FK value, we need to
            // reference that columnName instead of the default uuid

            // check the .indexField connection (if specified)
            let indexField = f.indexField;
            if (indexField) {
               if (indexField.object.id == f.object.id) {
                  sourcePkName = indexField.columnName;
               } else if (indexField.object.id == linkObject.id) {
                  targetPkName = indexField.columnName;
               }
            }

            // check the .indexField2 connection (if specified)
            let indexField2 = f.indexField2;
            if (indexField2) {
               if (indexField2.object.id == f.object.id) {
                  sourcePkName = indexField2.columnName;
               } else if (indexField2.object.id == linkObject.id) {
                  targetPkName = indexField2.columnName;
               }
            }

            relationMappings[relationName] = {
               relation: Model.ManyToManyRelation,
               modelClass: linkModel,
               join: {
                  // "{sourceTable}.{primaryField}"
                  from: `${sourceTableName}.${sourcePkName}`,

                  through: {
                     // "{joinTable}.{sourceColName}"
                     from: f.joinTableSourceColumnName,

                     // "{joinTable}.{targetColName}"
                     to: f.joinTableTargetColumnName,
                  },

                  // "{targetTable}.{primaryField}"
                  to: `${targetTableName}.${targetPkName}`,
               },
            };
         }
         // 1:M
         else if (LinkType == "one:many") {
            // in a 1:M relatiionship, the data from the linked object is
            // stored in THIS object's data.

            // if an .indexField is present in the connection settings, then
            // it references a column in the linked object's table to use for the
            // value being stored. (otherwise we default to the .PK() column)

            relationMappings[relationName] = {
               relation: Model.BelongsToOneRelation,
               modelClass: linkModel,
               join: {
                  // "{sourceTable}.{field}"
                  from: `${tableName}.${f.columnName}`,

                  // "{targetTable}.{primaryField}"
                  to: `${linkObject.dbTableName(true)}.${
                     f.indexField ? f.indexField.columnName : linkObject.PK()
                  }`,
               },
            };
         }
         // M:1
         else if (LinkType == "many:one") {
            // in a M:1 relatiionship, the data from THIS object is stored
            // in the linked object's data.

            // if an .indexField is present in the connection settings, then
            // it references a column in THIS object's table to use for the
            // value being stored. (otherwise we default to the .PK() column)

            relationMappings[relationName] = {
               relation: Model.HasManyRelation,
               modelClass: linkModel,
               join: {
                  // "{sourceTable}.{primaryField}"
                  from: `${tableName}.${
                     f.indexField ? f.indexField.columnName : this.object.PK()
                  }`,

                  // "{targetTable}.{field}"
                  to: `${linkObject.dbTableName(true)}.${linkField.columnName}`,
               },
            };
         }
      });

      return relationMappings;
   }

   /**
    * @method parseCondition
    * Return an SQL Where clause based upon the current condition object.
    * @param {obj} condition
    *        a QueryBuilder compatible condition object.
    *           cond.key : {string} The columnName or .uuid of the ABField this
    *                      condition is referencing.
    *           cond.rule: {string} The type of WHERE comparison we are making
    *           cond.value: {various} The comparison Value
    * @param {obj} userData
    *    The included user data for this request.
    * @param {ABUtil.reqService} req
    *        The request object associated with the current tenant/request
    */
   parseCondition(condition, userData, req) {
      // 'have_no_relation' condition will be applied later
      if (condition == null || condition.rule == "have_no_relation")
         return condition;

      let skipQuotes = false;
      // @const {boolean} skip adding `` around the key

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
            condition.key = field.conditionKey(userData, req);

            // if we are searching a multilingual field it is stored in translations so we need to search JSON
            if (field.isMultilingual) {
               // TODO: move to ABOBjectExternal.js
               // TODO: Legacy Implementation to work with HRIS objects:
               // Refactor out when we no longer have to support HRIS objects:
               if (
                  !this.object.viewName && // NOTE: check if this object is a query, then it includes .translations already
                  (field.object.isExternal || field.object.isImported)
               ) {
                  // eslint-disable-next-line no-constant-condition  -- Phasing this section out
                  if (false) {
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

                     // eslint-disable-next-line no-unused-vars  -- Phasing this section out
                     let languageWhere =
                        '`{prefix}`.`language_code` = "{languageCode}"'
                           .replace("{prefix}", prefix)
                           .replace("{languageCode}", userData.languageCode);

                     // if (glue == "or") Query.orWhereRaw(languageWhere);
                     // else Query.whereRaw(languageWhere);
                  } else {
                     req.notify.developer(
                        new Error(
                           "running code to manage external multilingual Tables"
                        ),
                        {
                           field,
                        }
                     );
                  }
               } else {
                  let transCol = `${field
                     .dbPrefix()
                     .replace(/`/g, "")}.translations`;

                  // If it is a query
                  if (this.object.viewName) {
                     // just wrap the whole transCol in ``
                     transCol = "`" + transCol + "`";
                  } else {
                     // each piece of the transCol "dbname.tablename.colname" needs to be
                     // wrapped in ``  ( `dbname`.`tablename`.`colname` )
                     transCol = "`" + transCol.split(".").join("`.`") + "`"; // "{prefix}.translations";
                  }

                  condition.key =
                     this.AB.Knex.connection(/* connectionName */).raw(
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
               condition.rule != "next_days" &&
               condition.rule != "is_current_date"
            ) {
               condition.key = `DATE(${condition.key})`;
               condition.value = `DATE("${condition.value}")`;
            }

            // Search string value of FK column
            else if (
               ["connectObject", "user"].indexOf(field.key) > -1 &&
               [
                  "contain",
                  "not_contain",
                  "equals",
                  "not_equal",
                  "in",
                  "not_in",
               ].indexOf(condition.rule) != -1
            ) {
               this.convertConnectFieldCondition(field, condition);
            } else if (field.key == "formula" || field.key == "calculate") {
               skipQuotes = true;
            }
         }
      }

      // We are going to use the 'raw' queries for knex becuase the '.'
      // for JSON searching is misinterpreted as a sql identifier
      // our basic where statement will be:
      var whereRaw = "{fieldName} {operator} {input}";

      // make sure a value is properly Quoted:
      function quoteMe(value) {
         if (value && value.replace) {
            // FIX: You have an error in your SQL syntax; check the manual that corresponds to your MariaDB server version for the right syntax to use near '
            value = value.replace(/'/g, "''");
         }
         return "'" + value + "'";
      }

      // remove fields from rules
      var fieldTypes = [
         "number_",
         "string_",
         "date_",
         "datetime_",
         "boolean_",
         "user_",
         "list_",
         "connectObject_",
      ];

      // convert QB Rule to SQL operation:
      var conversionHash = {
         equals: "=",
         not_equal: "<>",
         is_empty: "IS NULL",
         is_not_empty: "IS NOT NULL",
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
         checked: "IS TRUE",
         unchecked: "IS NOT TRUE", // FALSE or NULL
         // SQL queries
         like: "LIKE",
      };

      // normal field name:
      var columnName = condition.key;
      if (typeof columnName == "string" && !skipQuotes) {
         // make sure to ` ` columnName (if it isn't our special '1' condition )
         // see Policy:ABModelConvertSameAsUserConditions  for when that is applied
         if (columnName != "1") {
            if (columnName.indexOf("`") == -1) {
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
         case "like":
            // like: "searchTermWith%"
            operator = "LIKE";
            value = quoteMe(condition.value);
            break;

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
         case "not_contain_current_user":
            if (!userData.username) {
               if (condition.key == "contain_current_user") {
                  // if we wanted contains_current_user, but there wasn't a
                  // uservalue provided, then we want to make sure this
                  // condition doesn't return anything
                  //
                  // send a false by resetting the whereRaw to a fixed value.
                  // any future attempts to replace this will be ignored.
                  whereRaw = " 1=0 ";
               } else if (condition.key == "not_contain_current_user") {
                  // if we wanted not_contains_current_user, but there wasn't a
                  // uservalue provided, then we want to make sure this
                  // condition isn't limited by the lack of a username
                  //
                  // send a true by resetting the whereRaw to a fixed value.
                  // any future attempts to replace this will be ignored.
                  whereRaw = " 1=1 ";
               }
               break;
            }

            // Pull ABUserField when condition.key does not be .id of ABField
            if (field == null) {
               field = this.fields((f) => {
                  let condKey = (condition.key || "").replace(/`/g, "");

                  return (
                     condKey == f.columnName ||
                     condKey ==
                        `${f.dbPrefix()}.${f.columnName}`.replace(/`/g, "")
                  );
               })[0];
            }

            if (field) {
               // Query
               if (this.object.isQuery) {
                  // columnName = `JSON_SEARCH(JSON_EXTRACT(\`${
                  //    field.alias
                  // }.${field.relationName()}\`, '$[*].id'), 'one', '${
                  //    userData.username
                  // }')`;
                  // operator =
                  //    condition.rule != "contain_current_user" ? "IS" : "IS NOT";
                  // value = "NULL";

                  // WORKAROUND: 10.9.3-MariaDB-1:10.9.3+maria~ubu2204 has a JSON_EXTRACT bug.
                  // Believe it or not
                  //   SELECT `BASE_OBJECT.QX Code`, `BASE_OBJECT.Users__relation`, JSON_EXTRACT(`BASE_OBJECT.Users__relation`, '$[*].id')
                  //   FROM `AB_AccountingApp_ViewscopeFilterQXCenter`;
                  columnName = `\`${field.alias}.${field.relationName()}\``;
                  operator =
                     condition.rule == "contain_current_user"
                        ? "LIKE"
                        : "NOT LIKE";
                  value = `'%${userData.username}%'`;
               }
               // Object
               else {
                  columnName = `${this.object.dbTableName()}.${this.object.PK()}`;
                  operator =
                     condition.rule == "contain_current_user" ? "IN" : "NOT IN";
                  value = `(SELECT \`${this.object.name}\`
                           FROM \`${field.joinTableName()}\`
                           WHERE \`USER\` IN ('${userData.username}'))`;
               }
            }
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
         case "is_current_date":
            operator = "BETWEEN";
            var datetimerange = this.AB.rules.getUTCDayTimeRange().split("|");
            value = `"${datetimerange[0]}" AND "${datetimerange[1]}"`;
            break;
         case "is_empty":
         case "is_not_empty":
            // returns NULL if they are equal. Otherwise, the first expression is returned.
            columnName = `NULLIF(${columnName}, '')`;
            value = "";
            break;

         case "checked":
         case "unchecked":
            value = "";
            break;
      }

      // update our where statement:
      if (columnName && operator) {
         whereRaw = whereRaw
            .replace("{fieldName}", columnName)
            .replace("{operator}", operator)
            .replace("{input}", value != null ? value : "");

         return whereRaw;
      }
   }

   /**
    * queryConditionsJoinConditions()
    * A helper method to join all our parsed Conditions into a single WHERE
    * compatible SQL condition.
    * @param {obj} cond
    *        a QueryBuilder compatible condition object returned from
    *        this.queryConditionsParseConditions()
    * @return {string}
    */
   queryConditionsJoinConditions(cond, req) {
      if (_.isUndefined(cond)) return null;
      if (cond.glue) {
         // combine my sub rules into a single condition

         var rules = cond.rules
            .map((r) => this.queryConditionsJoinConditions(r, req))
            .filter((r) => r)
            .join(` ${cond?.glue.toUpperCase()} `);

         if (rules) {
            // if there were > 1 rule, then
            if (cond.rules.length > 1) {
               // return ( A AND B AND ... )
               return `( ${rules} )`;
            } else {
               // return A
               return rules;
            }
         }

         // this must have not had a meaningful condition, so
         // return NULL which will get filtered out.
         return null;
      }

      // return this individual condition:  ( A )
      if (typeof cond == "string") {
         return `( ${cond} )`;
      }

      // maybe it is an unprocessed cond obj:
      if (cond.key && cond.rule && cond.value) {
         return `( ${cond.key} ${cond.rule} ${cond.value} )`;
      }

      // maybe it is an empty condition {}
      if (_.isEmpty(cond)) {
         return null; // <-- this gets cleared out later
      }

      var error = new Error(
         "unknown cond type in .queryConditionsJoinCondition"
      );
      req.notify.developer(error, {
         context:
            "ABModel.queryConditionsJoinConditions: Error resolving condition",
         cond,
      });

      throw error;
   }

   /**
    * queryConditionsParseConditions()
    * A helper method to build a new cond object whose individual Rules are
    * the actual SQL conditions to be used.
    * @param {obj} cond
    *        a QueryBuilder compatible condition object
    * @param {obj} userData
    *    The included user data for this request.
    * @return {obj} newCond
    *        A copy of the given cond object
    */
   queryConditionsParseConditions(cond, userData, req) {
      // if this is a top level "glue" constructor,
      // build a new one
      if (cond?.glue) {
         var newCond = {
            glue: cond?.glue,
            rules: [],
         };
         (cond.rules || []).forEach((r) => {
            var newR = this.queryConditionsParseConditions(r, userData, req);
            if (newR) {
               newCond.rules.push(newR);
            } else {
               // ?? When would this happen??
               newCond.rules.push(r);
            }
         });
         return newCond;
      } else {
         return this.parseCondition(cond, userData, req);
      }
   }

   /**
    * queryConditionsPluckRelationConditions()
    * A helper method to remove the 'have_no_relation' and 'have_relation' conditions from our
    * conditions.
    * @param {obj} cond
    *        a QueryBuilder compatible condition object
    * @param {array} noRelationRules
    *        a list of the plucked conditions. This list will be updated
    *        as the conditions are evaluated and removed.
    * @param {array} haveRelationRules
    *        a list of the plucked conditions. This list will be updated
    *        as the conditions are evaluated and removed.
    * @return {obj} newCond
    *        A copy of the given cond object without the 'have_no_relation' and 'have_relation'
    *        conditions in them.
    */
   queryConditionsPluckRelationConditions(
      cond,
      noRelationRules = [],
      haveRelationRules = []
   ) {
      if (!cond) return null;

      // if this is a "glue" condition, then process each of it's rules:
      if (cond?.glue) {
         var newRules = [];
         (cond.rules || []).forEach((r) => {
            var pRule = this.queryConditionsPluckRelationConditions(
               r,
               noRelationRules,
               haveRelationRules
            );
            if (pRule) {
               newRules.push(pRule);
            }
         });

         cond.rules = newRules;
         return cond;
      } else {
         if (cond.rule == "have_no_relation") {
            noRelationRules.push(cond);
            return null;
         } else if (cond.rule == "have_relation") {
            haveRelationRules.push(cond);
            return null;
         }
         // this is an individual Rule
         // only return the ones that are NOT 'have_no_relation' and 'have_relation'
         else {
            return cond;
         }
      }
   }

   /**
    * queryConditions()
    * Convert our condition.where into a Knex .where() call.
    * @param {Knex} query
    * @param {obj} where
    *    a QueryBuilder compatible condition object
    * @param {obj} userData
    *    The included user data for this request.
    * @param {ABUtil.reqService} req
    *        The request object associated with the current tenant/request
    */
   queryConditions(query, where, userData, req) {
      // Apply filters
      if (!_.isEmpty(where)) {
         // if (req) {
         //    req.log(
         //       "ABModel.queryConditions(): .where condition:",
         //       JSON.stringify(where, null, 4)
         //    );
         // }

         // first, pull out our "have_no_relation" rules for later:
         var noRelationRules = [];
         const hasRelationRules = [];

         // make sure we don't edit the passed in where object
         where = this.AB.cloneDeep(where);

         where = this.queryConditionsPluckRelationConditions(
            where,
            noRelationRules,
            hasRelationRules
         );

         // Now walk through each of our conditions and turn them into their
         // sql WHERE statements
         var whereParsed = this.queryConditionsParseConditions(
            where,
            userData,
            req
         );

         // now join our where statements according to the .glue values
         var sqlWhere = this.queryConditionsJoinConditions(whereParsed, req);
         if (sqlWhere && sqlWhere.length > 0) {
            query.whereRaw(sqlWhere);
         }

         // Special Case:  'have_no_relation' or 'have_relation'
         // var noRelationRules = (where.rules || []).filter(
         //    (r) => r.rule == "have_no_relation"
         // );
         noRelationRules.concat(hasRelationRules).forEach((r) => {
            // var relation_name = AppBuilder.rules.toFieldRelationFormat(field.columnName);

            // var objectLink = field.objectLink();
            // if (!objectLink) return;

            // Query
            //  .leftJoinRelation(relation_name)
            //  .whereRaw('{relation_name}.{primary_name} IS NULL'
            //    .replace('{relation_name}', relation_name)
            //    .replace('{primary_name}', objectLink.PK()));

            // {
            //  key: "COLUMN_NAME", // no need to include object name
            //  rule: "have_no_relation",
            //  value: "LINK_OBJECT_PK_NAME"
            // }

            var field = this.object.fields((f) => f.id == r.key)[0];

            var relation_name = this.AB.rules.toFieldRelationFormat(
               field.columnName
            );

            var objectLink = field.datasourceLink;
            if (!objectLink) return;

            let fnJoinRelation;
            let whereRaw;
            if (r.rule == "have_no_relation") {
               // 1:1 - Get rows that no relation with
               fnJoinRelation = query.leftJoinRelation.bind(query);

               r.value = objectLink.PK();

               // "{relation_name}.{primary_name} IS NULL"
               whereRaw = `${relation_name}.${r.value} IS NULL`;
            } else if (r.rule == "have_relation") {
               // M:1 - Get rows that have relation with
               fnJoinRelation = query.innerJoinRelation.bind(query);

               whereRaw = `${relation_name}.${objectLink.PK()} = '${r.value}'`;
            }

            fnJoinRelation(relation_name).whereRaw(whereRaw);
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
         // var nameHash = {};
         if (populate) {
            this.populateFields(populate).forEach((f) => {
               let relationName = f.relationName();

               // Exclude .id column by adding (unselectId) function name to .withGraphFetched()
               if (f.datasourceLink?.PK() === "uuid") {
                  relationName += "(unselectId)";
               }

               // nameHash[relationName] = nameHash[relationName] || [];
               // nameHash[relationName].push(f);

               // Include username data of user fields of linked object
               // They are used to filter in FilterComplex on client
               let userFieldRelations = f.datasourceLink
                  .fields((fld) => fld?.key == "user")
                  .map((userFld) => `${userFld.relationName()}(username)`);
               if (userFieldRelations.length) {
                  userFieldRelations = _.uniq(userFieldRelations);
                  relationNames.push(
                     `${relationName}.[${userFieldRelations.join(",")}]`
                  );
               } else {
                  relationNames.push(relationName);
               }

               // Get translation data of External object
               if (
                  f.datasourceLink &&
                  f.datasourceLink.transColumnName &&
                  (f.datasourceLink.isExternal || f.datasourceLink.isImported)
               )
                  relationNames.push(`${f.relationName()}.[translations]`);
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

         const finalRelationNames = _.uniq(relationNames);

         // TODO: test for faulty relationNames
         /*
         if (finalRelationNames.length != relationNames.length) {
            var duplicateRelations = Object.keys(nameHash)
               .map((k) =>
                  nameHash[k].length > 1
                     ? { relation: k, fields: nameHash[k] }
                     : null
               )
               .filter((m) => m);
            this.AB.notify.builder(
               new Error(
                  `Object[${this.object.name}] seems to have duplicate relations defined.`
               ),
               {
                  context:
                     "ABModel.queryPopulate(): duplicate relations defined",
                  object: this.object,
                  relationNames,
                  duplicateRelations,
               }
            );
         }
         */

         // if (relationNames.length > 0) console.log(relationNames);
         query
            .withGraphFetched(`[${finalRelationNames.join(", ")}]`)
            .modifiers({
               // if the linked object's PK is uuid, then exclude .id
               unselectId: (builder) => {
                  builder.omit(["id"]);
               },
               username: (builder) => {
                  builder.select(["username"]);
               },
            });

         // Exclude .id column
         if (this.object.PK() === "uuid") query.omit(this.modelKnex(), ["id"]);
      }
   }

   /**
    * @method populateFields()
    * return the relevant fields that pass the given populate parameter.
    * @param {mixed} populate
    *        the given populate parameter that was passed in for this operation.
    * @return {array} {ABFieldConnect}
    */
   populateFields(populate) {
      if (populate) {
         return this.object.connectFields().filter((f) => {
            return (
               (populate === true || populate.indexOf(f.columnName) > -1) &&
               f.fieldLink != null
            );
         });
      }
      return [];
   }

   /**
    * populateMin();
    * reduce the populated data to a bare minimum for our UI
    * @param {json} data
    * @param {mixed} populate
    *    Any included sort parameters that might include a multilingual field.
    * @param {obj} userData
    *    The included user data for this request.
    */
   populateMin(data, populate) {
      if (populate) {
         this.populateFields(populate).forEach((f) => {
            // pull f => linkedObj
            var linkObj = f.datasourceLink;
            var minFields = linkObj.minRelationData();
            var relationName = f.relationName();
            let colNameList = f.object.fields().map((fld) => fld?.columnName);
            colNameList = colNameList.concat(
               f.object.connectFields().map((fld) => fld?.relationName?.())
            );
            var keysToRemove = colNameList.filter(
               (k) => minFields.indexOf(k) == -1
            );

            // using for loop for performance here
            for (var i = 0, data_length = data.length; i < data_length; ++i) {
               let set = data[i][relationName] || [];
               if (set && !Array.isArray(set)) set = [set];
               for (var s = 0, set_length = set.length; s < set_length; ++s) {
                  let entry = set[s];
                  for (
                     var j = 0, key_length = keysToRemove.length;
                     j < key_length;
                     ++j
                  ) {
                     delete entry[keysToRemove[j]];
                  }
               }
            }
         });
      }

      return Promise.resolve(data);
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
            if (o.key == "updated_at" || o.key == "created_at") {
               query.orderBy(o.key, o.dir.toLowerCase());
            }
            var orderField = this.object.fieldByID(o.key);
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
                  sortClause =
                     'JSON_UNQUOTE(JSON_EXTRACT(JSON_EXTRACT({prefix}.`translations`, SUBSTRING(JSON_UNQUOTE(JSON_SEARCH({prefix}.`translations`, "one", "{languageCode}")), 1, 4)), \'$."{columnName}"\'))'
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

            // Sort following the item list order
            if (orderField.key == "list") {
               // https://dev.mysql.com/doc/refman/8.0/en/string-functions.html#function_find-in-set
               query.orderByRaw(
                  `IFNULL(FIND_IN_SET(${sortClause}, "${o.dir}"), 999) ASC`
               );
            } else {
               query.orderByRaw(sortClause + " " + o.dir);
            }
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
   querySelectFormulaFields(query, userData, req) {
      // let raw = this.AB.Knex.connection().raw;

      // Formula fields
      let formulaFields = this.object.fields((f) => f.key == "formula");
      (formulaFields || []).forEach((f) => {
         let selectSQL = this.convertFormulaField(f, userData, req);
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
   convertFormulaField(formulaField, userData, req) {
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
            userData,
            req
         );

         let whereString = "";
         try {
            whereString = formulaFieldQuery.toKnexQuery().toString(); // select `DB_NAME`.`AB_TABLE_NAME`.* from `DB_NAME`.`AB_TABLE_NAME` where (`DB_NAME`.`AB_TABLE_NAME`.`COLUMN` LIKE '%VALUE%')
            // get only where clause
            const wherePosition = whereString.indexOf("where");
            if (wherePosition == -1) {
               throw new Error("No 'where' found in query");
            }
            whereString = whereString.substring(
               wherePosition + 5,
               whereString.length
            ); // It should be (`DB_NAME`.`AB_TABLE_NAME`.`COLUMN` LIKE '%VALUE%')

            // Replace definition id with col name
            const uuid = new RegExp(
               /[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}/g
            );
            // {Regex} should match uuids (from https://ihateregex.io/expr/uuid/)

            whereString = whereString.replace(uuid, (match) => {
               const { columnName } = this.AB.definitionByID(match);
               return columnName;
            });

            if (whereString) whereClause = ` AND ${whereString}`;
         } catch (e) {
            req.notify.developer(e, { field: formulaField });
         }
      }

      var LinkType = `${connectedField.settings.linkType}:${connectedField.settings.linkViaType}`;
      // {string} LinkType
      // represent the connection type as a string:
      // values: [ "one:one", "many:one", "one:many", "many:many" ]

      let connectedObjTable = `\`${connectedObj.dbSchemaName()}\`.\`${connectedObj.dbTableName()}\``;
      let objTable = `\`${this.object.dbSchemaName()}\`.\`${this.object.dbTableName()}\``;

      // M:1 or ( 1:1 & ! source)
      if (
         LinkType == "many:one" ||
         (LinkType == "one:one" && !connectedField.settings.isSource)
      ) {
         selectSQL = `(SELECT IFNULL(${type[settings.type]}(\`${
            numberField.columnName
         }\`), 0)
                  FROM ${connectedObjTable}
                  WHERE ${connectedObjTable}.\`${
            linkField.columnName
         }\` = ${objTable}.\`${
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
                  FROM ${connectedObjTable}
                  WHERE ${connectedObjTable}.\`${
            connectedField.indexField
               ? connectedField.indexField.columnName
               : connectedObj.PK()
         }\` = ${objTable}.\`${connectedField.columnName}\` ${whereClause})`;
      }
      // M:N
      else if (LinkType == "many:many") {
         let joinTable = `\`${connectedField.object.dbSchemaName()}\`.\`${connectedField.joinTableName()}\``,
            joinColumnNames = connectedField.joinColumnNames();

         selectSQL = `(SELECT IFNULL(${type[settings.type]}(\`${
            numberField.columnName
         }\`), 0)
               FROM ${connectedObjTable}
               INNER JOIN ${joinTable}
               ON ${joinTable}.\`${
            joinColumnNames.targetColumnName
         }\` = ${connectedObjTable}.${connectedObj.PK()}
               WHERE ${joinTable}.\`${
            joinColumnNames.sourceColumnName
         }\` = ${objTable}.\`${this.object.PK()}\` ${whereClause})`;
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
                  .map((v) => v.uuid || v.username || v)
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
            ["contains", "equals", "in"].indexOf(condition.rule) > -1
               ? "in"
               : "not_in";
      }
   }
};

/************************
 *** Update() Helpers ***
 ************************/

/**
 * doRelate()
 * perform a series of .relate() operations on a given record.
 *
 * @param {array} list
 *        the list uuid/PK() values to connect to this record
 * @param {Knex.record} objInst
 *        the Knex record instance that we want to add relations to
 * @param {string} rname
 * @param {string} alias
 * @param {Knex.Transaction?} trx - [optional]
 * @param {callback} cb
 *        The node style callback for when all values are processed.
 */
function doRelate(list, objInst, rname, alias, trx, cb) {
   if (list.length == 0) {
      cb();
   } else {
      let val = list.shift();
      let relateQuery = objInst
         .$relatedQuery(rname)
         .alias(alias) // FIX: SQL syntax error because alias name includes special characters
         .relate(val);

      // Used by knex.transaction, the transacting method may be chained to any query and
      // passed the object you wish to join the query as part of the transaction for.
      if (trx) relateQuery = relateQuery.transacting(trx);

      relateQuery
         .then(() => {
            doRelate(list, objInst, rname, alias, trx, cb);
         })
         .catch((err) => {
            cb(err);
         });
   }
}

/**
 * AddToRelateTasks()
 * Adds a properly formatted call to setRelate() to a list of tasks
 * that is passed in.
 * The primary use of this fn() is to preserve the param values for
 * when the delayed fn() is called so it references the correct values.
 * @param {array} listTasks
 *        the list of setRelate() calls that need to be made.
 * @param {ABObject} obj
 * @param {string} colName
 * @param {string} pk
 *        the {uuid} of the row being updated with the relationship
 * @param {string} val
 *        the value of the relationship being stored.
 * @param {Knex.Transaction?} trx - [optional]
 * @param {ABUtil.reqService} req
 *    The request object associated with the current tenant/request
 */
function AddToRelateTasks(listTasks, obj, colName, pk, vals, trx, req) {
   listTasks.push(() => obj.model().relate(pk, colName, vals, trx, req));
}

/**
 * AddToUnRelateTasks()
 * Adds a properly formatted call to setRelate() to a list of tasks
 * that is passed in.
 * The primary use of this fn() is to preserve the param values for
 * when the delayed fn() is called so it references the correct values.
 * @param {array} listTasks
 *        the list of setRelate() calls that need to be made.
 * @param {ABObject} obj
 * @param {string} colName
 * @param {string} pk
 *        the {uuid} of the row being updated with the relationship
 * @param {string} val
 *        the value of the relationship being stored.
 * @param {Knex.Transaction?} trx - [optional]
 * @param {ABUtil.reqService} req
 *    The request object associated with the current tenant/request
 */
function AddToUnRelateTasks(listTasks, obj, colName, pk, vals, trx, req) {
   listTasks.push(() => unRelate(obj, colName, pk, vals, trx, req));
}

/**
 * doSequential()
 * A recursive helper function that allows us to process a given list of
 * operations in sequential order.
 * The incoming list of tasks is an array of Fn() that return {Promise} of
 * their operations.  Each task is executed in order and once the .then()
 * is called, the next task will be executed.
 * @param {array:{fn}} tasks
 * @param {fn} cb
 *        a node style callback(err) to call once all operations have
 *        completed.
 */
function doSequential(tasks, cb) {
   if (tasks.length == 0) {
      cb();
   } else {
      tasks
         .shift()()
         .then(() => {
            doSequential(tasks, cb);
         })
         .catch(cb);
   }
}

/**
 * done()
 * A common callback routine that handles ending a performance measurement, and
 * resolving a Promise.
 * @param {Promise.resolve} resolve
 * @param {string} alias
 *        the performance measurement key
 * @param {req} req
 *        the incoming request object that performs the measurements.
 */
function done(resolve, alias, req) {
   if (req) {
      req.performance.measure(alias);
   }
   return resolve();
}

/**
 * unRelate()
 * remove the relations on the provided obj[columnName] from values
 * @param {ABObject} obj
 * @param {string} columnName
 *        the column name of the relations we are clearing.
 * @param {string} rowId
 *        the .uuid of the row we are working on.
 * @param {array} values
 *        the specific entries to remove.
 * @param {Knex.Transaction?} trx - [optional]
 * @param {ABUtil.reqService} req
 *    The request object associated with the current tenant/request
 * @return {Promise}
 */
function unRelate(obj, columnName, rowId, values, trx, req) {
   return new Promise((resolve, reject) => {
      // WORKAROUND : HRIS tables have non null columns
      if (obj.isExternal) return resolve();

      // create a new query to update relation data
      // NOTE: when use same query, it will have a "created duplicate" error
      let query = obj.model().modelKnex().query();
      if (trx) query = query.transacting(trx);

      let clearRelationName = obj.AB.rules.toFieldRelationFormat(columnName);
      let alias = `${columnName}_${clearRelationName}`;

      if (req) {
         req.log(`ABModel.update().unRelate(): ${alias}`);
         req.performance.mark(alias);
      }

      const fieldLink = obj.fields((f) => f.columnName == columnName)[0],
         objectLink = fieldLink.object,
         linkType = fieldLink
            ? `${fieldLink.linkType()}:${fieldLink.linkViaType()}`
            : null;

      query
         .where(obj.PK(), rowId)
         .first()
         .then((record) => {
            if (record == null || fieldLink == null || objectLink == null)
               return done(resolve, alias, req);

            // NOTE: if our field has linked to an index value, we have to use that
            // columnName here:
            let PK = fieldLink.indexField
               ? fieldLink.indexField.columnName
               : objectLink.PK();

            let unrelatePhase = record
               .$relatedQuery(clearRelationName)
               .alias(alias)
               .unrelate()
               .where(PK, "in", values);

            // Many-to-Many
            if (linkType == "many:many") {
               unrelatePhase = unrelatePhase
                  .orWhere(fieldLink.joinTableSourceColumnName, "in", values)
                  .orWhere(fieldLink.joinTableTargetColumnName, "in", values);
            }

            unrelatePhase
               .then(() => {
                  done(resolve, alias, req);
               })
               .catch((err) => {
                  // populate any error messages with the SQL of this
                  // query:
                  try {
                     err._sql = record.$query().toKnexQuery().toSQL().sql;
                  } catch (e) {
                     err._sql = "??";
                  }
                  reject(err);
               });
         })
         .catch((error) => {
            // populate any error messages with the SQL of this
            // query:
            try {
               error._sql = query.toKnexQuery().toSQL().sql;
            } catch (e) {
               error._sql = "??";
            }
            reject(error);
         });
   });
}

/**
 * setRelate()
 * set a relationship between obj[columnName] and value
 * @param {ABObject} obj
 * @param {string} columnName
 *        the column name of the relations we are creating.
 * @param {string} rowId
 *        the .uuid of the row we are working on.
 * @param {array} values
 *        one or more new values we are establishing a relation to.
 * @return {Promise}
 */
/*function setRelate(obj, columnName, rowId, values, req) {
   return new Promise((resolve, reject) => {
      // create a new query to update relation data
      // NOTE: when use same query, it will have a "created duplicate" error
      let query = obj.model().modelKnex().query();

      let relationName = obj.AB.rules.toFieldRelationFormat(columnName);

      let alias = `${columnName}_${relationName}`;
      let pAlias = `set_${alias}`;

      if (req) {
         req.log(`ABModel.update().setRelate(): ${alias}`);
         req.performance.mark(pAlias);
      }

      query
         .where(obj.PK(), rowId)
         .first()
         .then((record) => {
            if (record == null) return done(resolve, pAlias, req);

            record
               .$relatedQuery(relationName)
               .alias(alias)
               .relate(values)
               .then(() => {
                  done(resolve, pAlias, req);
               })
               .catch((err) => {
                  // populate any error messages with the SQL of this
                  // query:
                  try {
                     err._sql = record.$query().toKnexQuery().toSQL().sql;
                  } catch (e) {
                     err._sql = "??";
                  }
                  reject(err);
               });
         })
         .catch((error) => {
            // populate any error messages with the SQL of this
            // query:
            try {
               error._sql = query.toKnexQuery().toSQL().sql;
            } catch (e) {
               error._sql = "??";
            }
            reject(error);
         });
   });
}
*/

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
 * @param {obj} oldValue
 *        "key"=>"value" hash of the old entry in the DB.  We will use this to
 *        figure out what adjustments need to be made to the Relations.
 * @param {} trx
 * @param {req} req
 *        The request object if this is being used from a service.
 * @return {array}  array of update operations to perform the relations.
 */
function updateRelationValues(
   AB,
   object,
   id,
   updateRelationParams,
   oldValue,
   trx,
   req
) {
   var updateTasks = [];
   // {array} updateTasks
   // an array of the {Promise}s that are performing the updates.

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
         if (!field) return;

         var LinkType = `${field.settings.linkType}:${field.settings.linkViaType}`;
         // {string}
         // What is the R'ship between this field and it's connection: "one:one",
         // "one:many", etc...

         if (req)
            req.log(
               `ABModel.update().updateRelationValues(): ${colName} => ${LinkType}`
            );

         if (
            field &&
            field.settings.linkObject == object.id &&
            LinkType === "one:one" &&
            !object.isExternal
         ) {
            let sourceField = field.settings.isSource ? field : field.fieldLink;
            if (sourceField == null) return;

            let relateRowId = null;
            if (updateRelationParams[colName])
               // convert to int
               relateRowId = parseInt(updateRelationParams[colName]);

            // clear linked data
            updateTasks.push(
               () =>
                  new Promise((resolve, reject) => {
                     let update = {};
                     update[sourceField.columnName] = null;

                     let query = object.model().modelKnex().query();
                     if (trx) query = query.transacting(trx);
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
                  })
            );

            // set linked data
            if (updateRelationParams[colName]) {
               updateTasks.push(
                  () =>
                     new Promise((resolve, reject) => {
                        let update = {};
                        update[sourceField.columnName] = relateRowId;

                        let query = object.model().modelKnex().query();
                        if (trx) query = query.transacting(trx);
                        query
                           .update(update)
                           .clearWhere()
                           .where(object.PK(), id)
                           .then(() => {
                              resolve();
                           })
                           .catch((err) => reject(err));
                     })
               );

               updateTasks.push(
                  () =>
                     new Promise((resolve, reject) => {
                        let update = {};
                        update[sourceField.columnName] = id;

                        let query = object.model().modelKnex().query();
                        if (trx) query = query.transacting(trx);
                        query
                           .update(update)
                           .clearWhere()
                           .where(object.PK(), relateRowId)
                           .then(() => {
                              resolve();
                           })
                           .catch((err) => reject(err));
                     })
               );
            }
         }

         // Normal relations
         else {
            ////
            //// Optimize the updating of the relationships by first comparing
            //// the new values with the old values.  Only update the
            //// differences

            let delThese = [];
            // {array} entries that need to be removed from the relationship

            let origValues = oldValue[colName] || [];
            let newValues = updateRelationParams[colName] || [];

            if (!Array.isArray(origValues)) origValues = [origValues];
            if (!Array.isArray(newValues)) newValues = [newValues];

            let fPK = field.datasourceLink.PK();

            // make sure newValues are just the IDs
            newValues = newValues
               .filter((v) => v !== null)
               .map((v) => v[fPK] || v.id || v.uuid || v);

            let i = 0,
               len = origValues.length;
            while (i < len) {
               let o = origValues[i];
               // make sure it is the PK
               o = o[fPK] || o.id || o.uuid || o;

               let n = newValues.find((v) => v == o);
               if (n) {
                  // if they are found, nothing needs to happen
                  // so remove them from newValues;
                  newValues = newValues.filter((v) => v != o);
               } else {
                  // not found, so o is not supposed to be in there
                  delThese.push(o);
               }

               i++;
            }

            if (delThese.length > 0) {
               AddToUnRelateTasks(
                  updateTasks,
                  object,
                  colName,
                  id,
                  delThese,
                  trx,
                  req
               );
            }

            if (newValues.length > 0) {
               AddToRelateTasks(
                  updateTasks,
                  object,
                  colName,
                  id,
                  newValues,
                  trx,
                  req
               );
            }
         }
      });
   }

   return new Promise((resolve, reject) => {
      // if (req) {
      //    req.log(
      //       `ABModel.update().updateRelationValues(): there are ${updateTasks.length} tasks to perform sequentially`
      //    );
      // }

      // be sure all our updateTasks are executed sequentially
      doSequential(updateTasks, (err) => {
         if (err) {
            return reject(err);
         }
         resolve();
      });
   });
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
      transTableName = transModel.modelClass.tableName,
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
