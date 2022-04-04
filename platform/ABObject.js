const path = require("path");
// const _ = require("lodash");

const ABObjectCore = require(path.join(
   __dirname,
   "..",
   "core",
   "ABObjectCore.js"
));
// const Model = require("objection").Model;
// const ABModel = require(path.join(__dirname, "ABModel.js"));

const ConversionList = [
   require("../policies/ABModelConvertSailsCondition"),
   require("../policies/ABModelConvertFilterCondition"),
];
// {array} ConversionList
// an array of policies for converting our condition formats into
// our standard QueryBuilder format

const PolicyList = [
   require("../policies/ABModelConvertDataCollectionCondition"),
   require("../policies/ABModelConvertSameAsUserConditions"),
   require("../policies/ABModelConvertQueryConditions"),
   require("../policies/ABModelConvertQueryFieldConditions"),
];
// {array} PolicyList
// an array of the conversion policies we run on our conditions to
// prepare them for running.

// var __ObjectPool = {};
// var __ModelPool = {}; // reuse any previously created Model connections
// to minimize .knex bindings (and connection pools!)

module.exports = class ABClassObject extends ABObjectCore {
   constructor(attributes, AB) {
      super(attributes || {}, AB);

      /*
{
	id: uuid(),
	connName: 'string', // Sails DB connection name: 'appdev_default', 'legacy_hris', etc. Default is 'appBuilder'.
	name: 'name',
	labelFormat: 'xxxxx',
	isImported: 1/0,
	isExternal: 1/0,
	tableName:'string',  // NOTE: store table name of import object to ignore async
	transColumnName: 'string', // NOTE: store column name of translations table
	urlPath:'string',
	importFromObject: 'string', // JSON Schema style reference:  '#[ABApplication.id]/objects/[ABObject.id]'
								// to get other object:  ABApplication.objectFromRef(obj.importFromObject);
	translations:[
		{}
	],
	fields:[
		{ABDataField}
	]
}
*/

      // Get filter and sort conditions of current view to be default settings
      if (attributes.objectWorkspaceViews) {
         let currViewId = attributes.objectWorkspaceViews.currentViewID;

         let currView = attributes.objectWorkspaceViews.list.filter(
            (v) => v.id == currViewId
         )[0];
         if (currView) {
            this.objectWorkspace.filterConditions =
               currView.filterConditions || {};
            this.objectWorkspace.sortFields = currView.sortFields || [];
         }
      }
   }

   fromValues(attributes) {
      super.fromValues(attributes);

      // Make sure our table name is defined.
      if (this.tableName === "") {
         let app = this.AB.applicationByID(this.createdInAppID);
         if (!app) {
            this.tableName = this.AB.rules.toObjectNameFormat(this.name);
         } else {
            let appName = app.name || "GEN";
            this.tableName = this.AB.rules.toObjectNameFormat(
               `${appName}_${this.name}`
            );
         }

         // knex does not like .(dot) in table and column names
         // https://github.com/knex/knex/issues/2762
         this.tableName = this.tableName.replace(/[^a-zA-Z0-9_ ]/gi, "");
      }
   }

   currentView() {
      return this.objectWorkspace || {};
   }

   ///
   /// Instance Methods
   ///

   ///
   /// Import/Export Services
   ///

   /**
    * @method applyConnectFields()
    * reapply the connectFields we "stashed" earlier.
    */
   applyConnectFields() {
      (this._stashConnectFields || []).forEach((f) => {
         this._fields.push(f);
      });
      this._stashConnectFields = [];
   }

   /**
    * @method applyIndexes()
    * reapply the indexes we "stashed" earlier.
    */
   applyIndexes() {
      (this._stashIndexes || []).forEach((f) => {
         this._indexes.push(f);
      });
      this._stashIndexes = [];
   }

   /**
    * @method applyIndexNormal()
    * reapply the normal indexes we "stashed" earlier.
    */
   applyIndexNormal() {
      this._indexes = this._stashIndexNormal || [];
   }

   /**
    * @method getStashedIndexes()
    * return the array of stashed indexes.
    * @return {array} [...{ABIndex}] or {null}
    */
   getStashedIndexes() {
      if (!this._stashIndexes) return null;
      return this._stashIndexes;
   }

   /**
    * @method getStashedIndexNormals()
    * return the array of stashed normal indexes.
    * @return {array} [...{ABIndex}] or {null}
    */
   getStashedIndexNormals() {
      if (!this._stashIndexNormal) return null;
      return this._stashIndexNormal;
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

         // include my fields:
         this.fields().forEach((f) => {
            f.exportData(data);
         });

         this.indexes().forEach((i) => {
            i.exportData(data);
         });
      }
   }

   /**
    * @method exportIDs()
    * export any relevant .ids for the necessary operation of this application.
    * @param {array} ids
    *         the array of relevant ids to store our .ids into.
    */
   exportIDs(ids) {
      // make sure we don't get into an infinite loop:
      if (ids.indexOf(this.id) > -1) return;

      ids.push(this.id);

      // include my fields:
      this.fields().forEach((f) => {
         f.exportIDs(ids);
      });

      this.indexes().forEach((i) => {
         i.exportIDs(ids);
      });
   }

   /**
    * @method includeScopes()
    * modify the cond to apply scopes relevant to this ABObject. The passed
    * in cond object is directy modified, as well as being passed back in
    * the promise.
    * @param {obj} cond
    *        a querybuilder formatted condition clause
    * @param {obj} condDefaults
    * @param {ABUtil.reqService} req
    *        the request object for the job driving this transaction.
    * @return {Promise}
    */
   includeScopes(cond, condDefaults, req) {
      // Q: if this is being run as condDefaults.username == "_system"
      // should we simply return and not Scope?
      if (condDefaults.username == "_system_") {
         return Promise.resolve();
      }

      // still in progress:
      return new Promise((resolve, reject) => {
         // find Roles for user:
         var SiteUser = this.AB.objectUser().model();
         req.retry(() =>
            SiteUser.find({
               where: { username: condDefaults.username, isActive: 1 },
               populate: true,
            })
         ).then((list) => {
            var user = list[0];
            if (!user) {
               // This is unexpected ...
               var error = new Error(
                  `ABObject.includeScopes(): unknown or inactive user[${condDefaults.username}] `
               );
               req.notify.developer(error, {
                  context:
                     "ABObject.includeScopes: unknown or inactive user provided",
                  condDefaults,
                  req,
               });
               // treat this like an error
               return reject(error);
            }

            // pull all the Scopes for
            // V1 : method of scope definitions.
            // V2 : TODO: consider simplifying the structure and filters
            var allRoles = user.SITEROLE__relation || user.SITE_ROLE || [];
            if (allRoles.length == 0) {
               // Q: So no roles in the system means NO ACCESS. So let's not return any data:
               // add a 1=0 clause to prevent any results:
               cond.where = {
                  glue: "and",
                  rules: [cond.where, { key: "1", rule: "equals", value: "0" }],
               };
               req.notify.developer(
                  new Error(
                     "ABObject.includeScopes(): user has NO ROLES : preventing data access"
                  ),
                  {
                     context: "ABObject.includeScopes(): user has NO ROLES",
                     condDefaults,
                  }
               );
               // but continue on since this isn't technically an Error ...
               return resolve();
            }

            // find all the scopes related to these Roles:
            var Scopes = this.AB.objectScope().model();
            req.retry(() => Scopes.find({ roles: allRoles })).then((list) => {
               // pluck the filter that refer to a field in this object
               var myFieldIDs = this.fields().map((f) => f.id);
               var relatedRules = [];
               var isAllowAll = false;
               // {bool}
               // if the user has a role that allows all access, then skip any
               // filters.
               (list || []).forEach((scope) => {
                  if (scope.allowAll) {
                     isAllowAll = true;
                  }
                  if (scope.Filters && scope.Filters.rules) {
                     (scope.Filters.rules || []).forEach((r) => {
                        if (myFieldIDs.indexOf(r.key) > -1) {
                           relatedRules.push(r);
                        }
                     });
                  }
               });

               // if there are Rules that relate to this object
               if (!isAllowAll && relatedRules.length > 0) {
                  // we now have to apply our ScopeRules
                  var ScopeRules = {
                     glue: "or",
                     rules: relatedRules,
                  };

                  // if there are NO existing rules, these become our
                  // rules:
                  if (!cond.where || (cond.where.rules || []).length == 0) {
                     cond.where = ScopeRules;
                  } else {
                     // Otherwise, we need to AND our new ScopeRules
                     // together with the original Condition:
                     var newWhere = {
                        glue: "and",
                        rules: [cond.where, ScopeRules],
                     };
                     cond.where = newWhere;
                  }
               }
               return resolve();
            });
         });
      });
   }

   /**
    * @method stashConnectFields()
    * internally "stash" the connectFields away so we don't reference them.
    * We do this during an import, so we can create the base Object Tables
    * before we create connections between them.
    */
   stashConnectFields() {
      this._stashConnectFields = [];
      (this.connectFields() || []).forEach((f) => {
         this._stashConnectFields.push(f);
         this._fields = this.fields(function (o) {
            return o.id != f.id;
         });
      });
   }

   /**
    * @method stashIndexFieldsWithConnection()
    * internally "stash" these indexs away so we don't reference them.
    * We do this during an import, so that the connectFields are
    * created 1st before we try to create an index on them.
    */
   stashIndexFieldsWithConnection() {
      this._stashIndexes = [];
      // console.log("::: StashIndexFieldsWithConnection():");
      // console.log(`    indexes:`, this.indexes());
      (this.indexes() || []).forEach((indx) => {
         // console.log("       indx:", indx);
         var hasConnect =
            (indx.fields || []).filter((f) => f.isConnection).length > 0;
         if (hasConnect) {
            console.log(
               `:::: STASHING INDEX O[${this.label}].I[${indx.indexName}]`
            );
            this._stashIndexes.push(indx);
            this._indexes = this.indexes(function (o) {
               return o.id != indx.id;
            });
         }
      });
   }
   /**
    * @method stashIndexNormal()
    * internally "stash" these noraml indexs away so we don't reference them.
    * We do this during an import, so that we wait until all base fields are
    * created before we create any of the index fields.
    */
   stashIndexNormal() {
      this._stashIndexNormal = this._indexes;
      this._indexes = [];
   }

   ///
   /// Migration Services
   ///

   dbSchemaName() {
      // NOTE: .tenantDB() returns the db name enclosed with ` `
      // our KNEX/Objection.js tools perform their own quoting:
      return this.AB.req.tenantDB().replaceAll("`", "");
   }

   dbTableName(prefixSchema = false) {
      if (prefixSchema) {
         // pull database name
         var schemaName = this.dbSchemaName();

         return "#schema#.#table#"
            .replace("#schema#", schemaName)
            .replace("#table#", this.tableName);
      } else {
         return this.tableName;
      }
   }

   /**
    * @method migrateField()
    * tell a given field to perform it's .migrateCreate() action.
    * this is part of the .migrateCreate() => .migrateCreateFields() => migrageField()
    * process.
    * @param {ABField} f
    *        the current field we need to perform our migration.
    * @param {ABUtil.reqService} req
    *        the request object for the job driving the migrateCreate().
    * @param {knex} knex
    *        the Knex connection.
    * @return {Promise}
    */
   migrateField(f, req, knex) {
      return f.migrateCreate(req, knex).catch((err) => {
         req.notify.developer(err, {
            context: `field[${f.name || f.label}].migrateCreate(): error:`,
            field: f,
            AB: this.AB,
         });
         throw err;
      });
   }

   /**
    * @method migrateFieldsSequential()
    * process the given array of fields to migrate sequentially.
    * NOTE: doing this to reduce the chances of the DB server returning
    * ER_TABLE_EXISTS_ERROR: Table '`appbuilder-admin`.`#sql-alter-1-67`' already exists"
    * errors.
    * @param {array} fieldArray
    *        the current field we need to perform our migration.
    * @param {ABUtil.reqService} req
    *        the request object for the job driving the migrateCreate().
    * @param {knex} knex
    *        the Knex connection.
    * @return {Promise}
    */
   migrateFieldsSequential(fieldArray = [], req, knex) {
      return new Promise((resolve, reject) => {
         if (fieldArray.length == 0) {
            resolve();
         } else {
            var field = fieldArray.shift();
            this.migrateField(field, req, knex)
               .then(() => {
                  this.migrateFieldsSequential(fieldArray, req, knex)
                     .then(resolve)
                     .catch(reject);
               })
               .catch(reject);
         }
      });
   }

   /**
    * @method migrateCreateFields()
    * Step through all our fields and have them perform their .migrateCreate()
    * actions.  These fields need to be created in a specific order:
    *    normal Fields
    *    indexes
    *    connect Fields
    *
    * @param {ABUtil.reqService} req
    *        the request object for the job driving the migrateCreate().
    * @param {knex} knex
    *        the Knex connection.
    * @return {Promise}
    */
   migrateCreateFields(req, knex) {
      // normal fields don't depend on other fields to be created first.
      // connect and combine fields depend on other fields being created 1st.
      // so we track them to be created in later steps.
      var connectFields = this.connectFields();
      var combinedFields = this.fields((f) => f?.key == "combined");
      var nonNormalFields = connectFields.concat(combinedFields);

      return Promise.resolve()
         .then(() => {
            //// NOTE: NOW the table is created
            //// let's go add our normal fields to it:
            let fieldUpdates = [];

            let normalFields = this.fields(
               (f) => f && !nonNormalFields.find((c) => c.id == f.id)
            );

            // {fix} ER_TABLE_EXISTS_ERROR: Table '`appbuilder-admin`.`#sql-alter-1-67`' already exists"
            // switch to performing field migrations in Sequence:
            return this.migrateFieldsSequential(normalFields, req, knex);
         })
         .then(() => {
            // Now our base fields are there, create our combined fields
            return this.migrateFieldsSequential(combinedFields, req, knex);
         })
         .then(() => {
            // Now Create our indexes
            return this.migrateFieldsSequential(this.indexes(), req, knex);
         })
         .then(() => {
            // finally create any connect Fields
            return this.migrateFieldsSequential(connectFields, req, knex);
         })
         .catch((err) => {
            this.AB.notify.developer(err, {
               context: `ABObject[${this.label}]:migrateCreateFields(): Error migrating fields`,
            });
            throw err;
         });
   }

   /**
    * migrateCreate
    * verify that a table for this object exists.
    * @param {ABUtil.reqService} req
    *        the request object for the job driving the migrateCreate().
    * @param {knex} knex
    *        the Knex connection.
    * @return {Promise}
    */
   async migrateCreate(req, knex) {
      knex = knex || this.AB.Knex.connection(this.connName);

      var tableName = this.dbTableName();

      return new Promise((resolve, reject) => {
         req.retry(() => knex.schema.hasTable(tableName))
            .then((exists) => {
               // if it doesn't exist, then create it and any known fields:
               if (!exists) {
                  req.log(
                     `    ... creating -> O[${
                        this.name || this.label
                     }]->table[${tableName}]`
                  );

                  return req
                     .retry(() =>
                        knex.schema.createTable(tableName, (t) => {
                           //// NOTE: the table is NOT YET CREATED here
                           //// we can just modify the table definition

                           // Use .uuid to be primary key instead
                           // t.increments('id').primary();
                           t.string("uuid").primary();
                           // NOTE: MySQL version 5 does not support default with a function
                           // .defaultTo(knex.raw('uuid()')));

                           t.timestamps();
                           t.engine("InnoDB");
                           t.charset("utf8");
                           t.collate("utf8_unicode_ci");

                           // Adding a new field to store various item properties in JSON (ex: height)
                           t.text("properties");
                        })
                     )
                     .then(() => {
                        return this.migrateCreateFields(req, knex);
                     })
                     .then(resolve)
                     .catch(reject);
               } else {
                  req.log(
                     `    ... exists -> O[${
                        this.name || this.label
                     }] -> table[${tableName}]`
                  );

                  // the Object might already exist,  but we need to make sure any added
                  // fields are created.
                  this.migrateCreateFields(req, knex)
                     .then(resolve)
                     .catch(reject);
               }
            })
            .catch(reject);
      });
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
      knex = knex || this.AB.Knex.connection(this.connName);
      var tableName = this.dbTableName();

      //BEFORE we just go drop the table, let's give each of our
      // fields the chance to perform any clean up actions related
      // to their columns being removed from the system.
      //   Image Fields, Attachment Fields, Connection Fields, etc...

      // QUESTION: When removing ConnectionFields:  If other objects connect to this object, we
      // need to decide how to handle that:
      // - auto remove those fields from other objects?
      // - perform the corrections here, or alert the USER in the UI and expect them to
      //   make the changes manually?

      let fieldDrops = [];

      this.fields().forEach((f) => {
         fieldDrops.push(f.migrateDrop(req, knex));
      });

      try {
         await Promise.all(fieldDrops);
         await knex.schema.dropTableIfExists(tableName);
      } catch (e) {
         this.AB.notify.developer(e, {
            context: "ABObject.migrateDrop(): error",
            req,
            obj: this.toObj(),
         });
         throw e;
      }
   }

   ///
   /// DB Model Services
   ///

   /* modelName() {
      return this.id.replace(/[^a-zA-Z]/g, ""); // remove special characters and numbers to allow model name to be class name

      // let appName = this.application.name,
      // 	tableName = this.dbTableName(true);

      // return '#appName##tableName#'
      // 		.replace('#appName#', appName)
      // 		.replace('#tableName#', tableName)
      // 		.replace(/[^a-zA-Z0-9]/g, ""); // remove special characters to allow model name to be class name

      // return this.tableName.replace(/[^a-zA-Z0-9]/g, ""); // remove special characters to allow model name to be class name
   }
*/
   /**
    * model()
    * return an instance of ABModel that can operate the data for this ABObject
    * @return {ABModel}
    */
   // model() {
   //    return super.model();
   // }

   /**
    * @method model
    * return an objection.js model for working with the data in this Object.
    * @return {Objection.Model}
    */
   /*
   modelKnex() {
      var modelName = this.modelName(),
         tableName = this.dbTableName(true);

      if (!__ModelPool[modelName]) {
         var knex = ABMigration.connection(
            this.isImported ? this.connName : undefined
         );

         // Compile our jsonSchema from our DataFields
         // jsonSchema is only used by Objection.js to validate data before
         // performing an insert/update.
         // This does not DEFINE the DB Table.
         var jsonSchema = {
            type: "object",
            required: [],
            properties: this.modelDefaultFields(),
         };
         var currObject = this;
         var allFields = this.fields();
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
            return this.modelRelation();
         };

         // bind knex connection to object model
         // NOTE : when model is bound, then relation setup will be executed
         __ModelPool[modelName] = __ModelPool[modelName].bindKnex(knex);
      }

      return __ModelPool[modelName];
   }
   */

   /*   modelRelation() {
      var tableName = this.dbTableName(true);

      // Compile our relations from our DataFields
      var relationMappings = {};

      var connectFields = this.connectFields();

      // linkObject: '', // ABObject.id
      // linkType: 'one', // one, many
      // linkViaType: 'many' // one, many

      connectFields.forEach((f) => {
         // find linked object name
         // var linkObject = this.application.objects((obj) => { return obj.id == f.settings.linkObject; })[0];
         let linkObject = this.AB.objectByID(f.settings.linkObject);
         if (linkObject == null) return;

         var linkField = f.fieldLink;
         if (linkField == null) return;

         var linkModel = linkObject.model();
         var relationName = f.relationName();

         // 1:1
         if (f.settings.linkType == "one" && f.settings.linkViaType == "one") {
            var sourceTable, targetTable, targetPkName, relation, columnName;

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
                  : this.PK();
               relation = Model.HasOneRelation;
               columnName = linkField.columnName;
            }

            relationMappings[relationName] = {
               relation: relation,
               modelClass: linkModel,
               join: {
                  from: "{targetTable}.{primaryField}"
                     .replace("{targetTable}", targetTable)
                     .replace("{primaryField}", targetPkName),

                  to: "{sourceTable}.{field}"
                     .replace("{sourceTable}", sourceTable)
                     .replace("{field}", columnName),
               },
            };
         }
         // M:N
         else if (
            f.settings.linkType == "many" &&
            f.settings.linkViaType == "many"
         ) {
            // get join table name
            let joinTablename = f.joinTableName(true),
               joinColumnNames = f.joinColumnNames(),
               sourceTableName,
               sourcePkName,
               targetTableName;

            sourceTableName = f.object.dbTableName(true);
            sourcePkName = f.object.PK();
            targetTableName = linkObject.dbTableName(true);
            targetPkName = linkObject.PK();

            let indexField = f.indexField;
            if (indexField) {
               if (indexField.object.id == f.object.id) {
                  sourcePkName = indexField.columnName;
               } else if (indexField.object.id == linkObject.id) {
                  targetPkName = indexField.columnName;
               }
            }

            let indexField2 = f.indexField2;
            if (indexField2) {
               if (indexField2.object.id == f.object.id) {
                  sourcePkName = indexField2.columnName;
               } else if (indexField2.object.id == linkObject.id) {
                  targetPkName = indexField2.columnName;
               }
            }

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
                  from: "{sourceTable}.{primaryField}"
                     .replace("{sourceTable}", sourceTableName)
                     .replace("{primaryField}", sourcePkName),

                  through: {
                     from: "{joinTable}.{sourceColName}"
                        .replace("{joinTable}", joinTablename)
                        .replace(
                           "{sourceColName}",
                           joinColumnNames.sourceColumnName
                        ),

                     to: "{joinTable}.{targetColName}"
                        .replace("{joinTable}", joinTablename)
                        .replace(
                           "{targetColName}",
                           joinColumnNames.targetColumnName
                        ),
                  },

                  to: "{targetTable}.{primaryField}"
                     .replace("{targetTable}", targetTableName)
                     .replace("{primaryField}", targetPkName),
               },
            };
         }
         // 1:M
         else if (
            f.settings.linkType == "one" &&
            f.settings.linkViaType == "many"
         ) {
            relationMappings[relationName] = {
               relation: Model.BelongsToOneRelation,
               modelClass: linkModel,
               join: {
                  from: "{sourceTable}.{field}"
                     .replace("{sourceTable}", tableName)
                     .replace("{field}", f.columnName),

                  to: "{targetTable}.{primaryField}"
                     .replace("{targetTable}", linkObject.dbTableName(true))
                     .replace(
                        "{primaryField}",
                        f.indexField ? f.indexField.columnName : linkObject.PK()
                     ),
               },
            };
         }
         // M:1
         else if (
            f.settings.linkType == "many" &&
            f.settings.linkViaType == "one"
         ) {
            relationMappings[relationName] = {
               relation: Model.HasManyRelation,
               modelClass: linkModel,
               join: {
                  from: "{sourceTable}.{primaryField}"
                     .replace("{sourceTable}", tableName)
                     .replace(
                        "{primaryField}",
                        f.indexField ? f.indexField.columnName : this.PK()
                     ),

                  to: "{targetTable}.{field}"
                     .replace("{targetTable}", linkObject.dbTableName(true))
                     .replace("{field}", linkField.columnName),
               },
            };
         }
      });

      return relationMappings;
   }

   modelDefaultFields() {
      return {
         uuid: { type: "string" },
         created_at: {
            type: ["null", "string"],
            pattern: AppBuilder.rules.SQLDateTimeRegExp,
         },
         updated_at: {
            type: ["null", "string"],
            pattern: AppBuilder.rules.SQLDateTimeRegExp,
         },
         properties: { type: ["null", "object"] },
      };
   }
*/
   /**
    * @method modelRefresh
    * when the definition of a model changes, we need to clear our cached
    * model definitions.
    * NOTE: called from our ABField.migrateXXX methods.
    */
   /*   modelRefresh() {
      var modelName = this.modelName();
      delete __ModelPool[modelName];

      ABMigration.refreshObject(this);
   }
*/
   /**
    * @method queryFind
    * return an Objection.js QueryBuilder (basically a knex QueryBuilder with
    * a few additional methods).
    * NOTE: ObjectQuery overrides this to return queries already joined with
    * multiple tables.
    * @param {obj} options
    *		A set of optional conditions to add to the find():
    * @param {obj} userData
    * 		The current user's data (which can be used in our conditions.)
    * @return {QueryBuilder}
    */
   /*   queryFind(options = {}, userData) {
      let query = this.model().query();

      return Promise.resolve()
         .then(() => this.populateFindConditions(query, options, userData))
         .then(() => {
            try {
               // sails.log.debug(
               //    "ABClassObject.queryFind - SQL:",
               // query.toString();
               // );
            } catch (e) {
               // sails.log.debug('ABClassObject.queryFind - SQL:', query.debug() );
            }

            return query;
         });
   }
*/
   /**
    * @method queryCount
    * return an Objection.js QueryBuilder that is already setup for this object.
    * NOTE: ObjectQuery overrides this to return queries already joined with
    * multiple tables.
    * @param {obj} options
    *		A set of optional conditions to add to the find():
    * @param {obj} userData
    * 		The current user's data (which can be used in our conditions.)
    * @param {string} tableName
    * 		[optional] the table name to use for the count
    * @return {QueryBuilder}
    */
   /*   queryCount(options = {}, userData, tableName) {
      if (_.isUndefined(tableName)) {
         tableName = this.model().tableName;
      }

      // we don't include relative data on counts:
      // and get rid of any .sort, .offset, .limit
      options.populate = false;
      delete options.sort;
      delete options.offset;
      delete options.limit;

      // // added tableName to id because of non unique field error
      // return this.queryFind(options, userData)
      // .then((query)=>{
      //     // TODO:: we need to figure out how to return the count not the full data
      //     return query.length;
      // });

      let query = this.model().query();

      return Promise.resolve()
         .then(() => this.populateFindConditions(query, options, userData))
         .then(() => {
            let pkField = `${tableName}.${this.PK()}`;

            query = query
               .eager("")
               .clearSelect()
               .countDistinct(`${pkField} as count`)
               .whereNotNull(pkField)
               .first();

            try {
               // sails.log.debug(
               //    "ABClassObject.queryCount - SQL:",
               //    query.toString()
               // );
            } catch (e) {
               // sails.log.debug('ABClassObject.queryFind - SQL:', query.debug() );
            }

            return query;
         });
   }
*/
   /**
    * @method requestParams
    * Parse through the given parameters and return a subset of data that
    * relates to the fields in this object.
    * @param {obj} allParameters  a key=>value hash of the inputs to parse.
    * @return {obj}
    */
   requestParams(allParameters) {
      var usefulParameters = {};
      this.fields().forEach((f) => {
         var p = f.requestParam(allParameters);
         if (p) {
            for (var a in p) {
               // if ( (Array.isArray(p[a]) && p[a].length) || !Array.isArray(p[a]))
               usefulParameters[a] = p[a];
            }
         }
      });

      return usefulParameters;
   }

   requestRelationParams(allParameters) {
      var usefulParameters = {};
      this.connectFields().forEach((f) => {
         if (f.requestRelationParam) {
            var p = f.requestRelationParam(allParameters);
            if (p) {
               for (var a in p) {
                  // if ( (Array.isArray(p[a]) && p[a].length) || !Array.isArray(p[a]))
                  usefulParameters[a] = p[a];
               }
            }
         }
      });

      return usefulParameters;
   }

   /**
    * @method isValidData
    * Parse through the given data and return an array of any invalid
    * value errors.
    * @param {obj} allParameters  a key=>value hash of the inputs to parse.
    * @return {array}
    */
   //// TODO: create OP.Validation.validator() and use super.isValidData() instead.
   isValidData(allParameters) {
      var errors = [];
      this.fields().forEach((f) => {
         var p = f.isValidData(allParameters);
         if (p.length > 0) {
            errors = errors.concat(p);
         }
      });

      return errors;
   }

   /**
    * @method postGet
    * Allow our DataFields another pass at the data before returning it to the
    * client.  Our DataFields can do any post conditioning of their data
    * before it is sent back.
    * @param {array} data  array of table rows returned from our table.
    * @return {Promise}
    */
   async postGet(data) {
      var allActions = [];
      data.forEach((d) => {
         this.fields().forEach((f) => {
            allActions.push(f.postGet(d)); // update data in place.
         });
      });
      await Promise.all(allActions);
   }

   convertToQueryBuilderConditions(cond, indx = 0) {
      if (indx < ConversionList.length) {
         // load the policy
         let policy = ConversionList[indx];

         policy(this.AB, cond, () => {
            // try the next one
            this.convertToQueryBuilderConditions(cond, indx + 1);
         });
      }
   }

   /**
    * reduceConditions()
    * update a given condition object and reduce the embedded queries
    * into actual results.  For example, if one of the conditions was
    * Object NOT IN Query(X), we would perform the query and translate
    * that to OBJECT ID NOT IN [x, y, z].
    * @param {obj} _where
    *       The condition hash that contains the details of our lookup:
    *       {
    *          where : {Array}
    *          sort :  {Array}
    *          offset: {Integer}
    *          limit:  {Integer}
    *          populate: {Boolean}
    *       }
    * @param {obj} userData
    *       many of our queries need to know some info about the User
    *       this request is running under.
    *       {
    *          username: {string},
    *          languageCode: {string}, - 'en', 'th'
    *       }
    * @param {ABUtil.reqService} req
    *        the request object for the job driving the migrateCreate().
    * @return {Promise}
    */
   reduceConditions(_where, userData, req) {
      // run the options.where through our existing policy filters
      // get array of policies to run through
      let processPolicy = (indx, cb) => {
         if (indx >= PolicyList.length) {
            cb();
         } else {
            // load the policy
            let policy = PolicyList[indx];

            policy(
               this.AB,
               _where,
               this,
               userData,
               (err) => {
                  if (err) {
                     cb(err);
                  } else {
                     // try the next one
                     processPolicy(indx + 1, cb);
                  }
               },
               req
            );
            /*
             * OLD FORMAT:
             *
            // run the policy on my data
            // policy(req, res, cb)
            //    req.options._where
            //  req.user.data
            let myReq = {
               AB: this.AB,
               options: {
                  _where: _where,
               },
               user: {
                  data: userData,
               },
               param: (id) => {
                  if (id == "appID") {
                     console.error(
                        "appID being requested from processPolicy: WHY?"
                     );
                     return this.application.id;
                  } else if (id == "objID") {
                     return this.id;
                  }
               },
            };

            policy(myReq, {}, (err) => {
               if (err) {
                  cb(err);
               } else {
                  // try the next one
                  processPolicy(indx + 1, cb);
               }
            });
            */
         }
      };

      return new Promise((resolve, reject) => {
         // run each One
         processPolicy(0, (err) => {
            // now that I'm through with updating our Conditions
            if (err) {
               reject(err);
            } else {
               resolve();
            }
         });
      });
   }

   /**
    * @function populateFindConditions
    * Add find conditions and include relation data to Knex.query
    *
    * @param {Knex.query} query
    * @param {Object} options - {
    *                              where : {Array}
    *                              sort :  {Array}
    *                              offset: {Integer}
    *                              limit:  {Integer}
    *                              populate: {Boolean}
    *                           }
    * @param {string} userData - {
    *                              username: {string},
    *                              guid: {string},
    *                              languageCode: {string}, - 'en', 'th'
    *                              ...
    *                             }
    * @return {Promise}
    */
   /*   populateFindConditions(query, options, userData = {}) {
      var where = {
            glue: "and",
            rules: [],
         },
         sort = options.sort,
         offset = options.offset,
         limit = options.limit;

      if (options.where && options.where.rules && options.where.rules.length)
         where.rules.push(options.where);

      return (
         Promise.resolve()

            // Apply filters from scopes
            .then(
               () =>
                  new Promise((next, err) => {
                     if (this.isSystemObject) return next();

                     let objectIds = [];

                     // if this is ABObjectQuery then return all ids
                     if (this.viewName) {
                        objectIds = this.objects().map((obj) => obj.id);
                     }
                     // ABObject
                     else {
                        objectIds = [this.id];
                     }

                     // let ABObjectScope = ABSystemObject.getObjectScope();
                     this.pullScopes({
                        username: userData.username,
                        objectIds: objectIds,
                        ignoreQueryId: this.viewName ? this.id : null,
                     })
                        .catch(err)
                        .then((scopes) => {
                           // Check if user is anonymous
                           if (!scopes || scopes.length < 1) return next(true);

                           let scopeWhere = {
                              glue: "and",
                              rules: [],
                           };

                           (scopes || []).forEach((s) => {
                              if (
                                 !s ||
                                 (s.objectIds || []).filter((objId) =>
                                    objectIds.includes(objId)
                                 ).length < 1 // intersection values from 2 arrays
                              )
                                 return;

                              // no where filter - return all data
                              if (!s.filter) {
                                 s.filter = {};
                                 s.filter.glue = "or";
                              }

                              let scopeRule = {
                                 glue: s.filter.glue,
                                 rules: [],
                              };

                              (s.filter.rules || []).forEach((r) => {
                                 if (!r.key) return;

                                 (
                                    this.fields((f) => f.id == r.key) || []
                                 ).forEach((fld) => {
                                    let newRule = {
                                       key: r.key,
                                       rule: r.rule,
                                       value: r.value,
                                    };

                                    if (fld.alias) newRule.alias = fld.alias;

                                    scopeRule.rules.push(newRule);
                                 });
                              });

                              scopeWhere.rules.push(scopeRule);
                           });

                           let isSeeAll =
                              (scopes || []).filter((s) => s.allowAll).length >
                              0;

                           if (isSeeAll) {
                              return next(false);
                           }
                           // Anonymous
                           else if (
                              // It has to be ABObject (not ABObjectQuery)
                              !this.viewName &&
                              scopeWhere.rules.length == 0
                           ) {
                              return next(true);
                           }
                           // Process filter policies
                           else {
                              this.processFilterPolicy(
                                 scopeWhere,
                                 userData
                              ).then(() => {
                                 where.rules.push(scopeWhere);
                                 next(false);
                              });
                           }
                        });
                  })
            )
            .then(
               (isBlocked) =>
                  new Promise((next, err) => {
                     // If user is anonymous, then return empty data.
                     if (isBlocked) {
                        query.clearWhere().whereRaw("1 = 0");
                        return next();
                     }

                     // Apply filters
                     if (!_.isEmpty(where)) {
                        sails.log.info(
                           "ABClassObject.populateFindConditions(): .where condition:",
                           JSON.stringify(where, null, 4)
                        );

                        // @function parseCondition
                        // recursive fn() to step through each of our provided conditions and
                        // translate them into query.XXXX() operations.
                        // @param {obj} condition  a QueryBuilder compatible condition object
                        // @param {ObjectionJS Query} Query the query object to perform the operations.
                        // @param {string} glue ["and" || "or"]- needs to set .orWhere or .where inside Grouping query of knex. https://github.com/knex/knex/issues/1254
                        var parseCondition = (
                           condition,
                           Query,
                           glue = "and"
                        ) => {
                           // 'have_no_relation' condition will be applied below
                           if (
                              condition == null ||
                              condition.rule == "have_no_relation"
                           )
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
                                    parseCondition(
                                       r,
                                       this,
                                       condition.glue || "and"
                                    );
                                 });
                              });

                              return;
                           }

                           // Convert field id to column name
                           if (this.AB.rules.isUuid(condition.key)) {
                              var field = this.fields((f) => {
                                 return (
                                    f.id == condition.key &&
                                    (!condition.alias ||
                                       f.alias == condition.alias)
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
                                       !this.viewName && // NOTE: check if this object is a query, then it includes .translations already
                                       (field.object.isExternal ||
                                          field.object.isImported)
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
                                             .replace(
                                                "{tableName}",
                                                transTable
                                             );
                                       }

                                       condition.key = "{prefix}.{columnName}"
                                          .replace("{prefix}", prefix)
                                          .replace(
                                             "{columnName}",
                                             field.columnName
                                          );

                                       let languageWhere = '`{prefix}`.`language_code` = "{languageCode}"'
                                          .replace("{prefix}", prefix)
                                          .replace(
                                             "{languageCode}",
                                             userData.languageCode
                                          );

                                       if (glue == "or")
                                          Query.orWhereRaw(languageWhere);
                                       else Query.whereRaw(languageWhere);
                                    } else {
                                       let transCol;
                                       // If it is a query
                                       if (this.viewName)
                                          transCol = "`{prefix}.translations`";
                                       else transCol = "{prefix}.translations";

                                       transCol = transCol.replace(
                                          "{prefix}",
                                          field.dbPrefix().replace(/`/g, "")
                                       );

                                       condition.key = ABMigration.connection().raw(
                                          'JSON_UNQUOTE(JSON_EXTRACT(JSON_EXTRACT({transCol}, SUBSTRING(JSON_UNQUOTE(JSON_SEARCH({transCol}, "one", "{languageCode}")), 1, 4)), \'$."{columnName}"\'))'
                                             .replace(/{transCol}/g, transCol)
                                             .replace(
                                                /{languageCode}/g,
                                                userData.languageCode
                                             )
                                             .replace(
                                                /{columnName}/g,
                                                field.columnName
                                             )
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
                                    var inputID = field.settings.options.filter(
                                       (option) =>
                                          option.id == condition.value ||
                                          option.text == condition.value
                                    )[0];
                                    if (inputID) condition.value = inputID.id;
                                 }

                                 // DATE (not DATETIME)
                                 else if (field.key == "date") {
                                    condition.key = `DATE(${condition.key})`;
                                    condition.value = `DATE("${condition.value}")`;
                                 }

                                 // Search string value of FK column
                                 else if (
                                    field.key == "connectObject" &&
                                    (condition.rule == "contains" ||
                                       condition.rule == "not_contains" ||
                                       condition.rule == "equals" ||
                                       condition.rule == "not_equal")
                                 ) {
                                    this.convertConnectFieldCondition(
                                       field,
                                       condition
                                    );
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
                              if (
                                 columnName != "1" &&
                                 columnName.indexOf("`") == -1
                              ) {
                                 // if columnName is  a  table.field  then be sure to `` each one individually
                                 var parts = columnName.split(".");
                                 for (var p = 0; p < parts.length; p++) {
                                    parts[p] = "`" + parts[p] + "`";
                                 }
                                 columnName = parts.join(".");
                              }

                              // ABClassQuery:
                              // If this is query who create MySQL view, then column name does not have `
                              if (this.viewName) {
                                 columnName =
                                    "`" + columnName.replace(/`/g, "") + "`";
                              }
                           }

                           // remove the field type from the rule
                           var rule = condition.rule;
                           fieldTypes.forEach((f) => {
                              rule = rule.replace(f, "");
                           });
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
                              case "not_contain_current_user":
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
                                    columnName = this.PK();
                                    operator =
                                       condition.rule == "contain_current_user" ? "IN" : "NOT IN";
                                    value = `(SELECT \`${this.name}\`
                                             FROM \`${field.joinTableName()}\`
                                             WHERE \`USER\` IN ('${userData.username}'))`;
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
                                 .replace(
                                    "{input}",
                                    value != null ? value : ""
                                 );

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

                           var field = this.fields((f) => f.id == r.key)[0];

                           var relation_name = AppBuilder.rules.toFieldRelationFormat(
                              field.columnName
                           );

                           var objectLink = field.datasourceLink;
                           if (!objectLink) return;

                           r.value = objectLink.PK();

                           query
                              .leftJoinRelation(relation_name)
                              .whereRaw(
                                 "{relation_name}.{primary_name} IS NULL"
                                    .replace("{relation_name}", relation_name)
                                    .replace("{primary_name}", r.value)
                              );
                        });
                     }

                     // Apply Sorts
                     if (!_.isEmpty(sort)) {
                        sort.forEach((o) => {
                           var orderField = this.fields(
                              (f) => f.id == o.key
                           )[0];
                           if (!orderField) return;

                           // if we are ordering by a multilingual field it is stored in translations so we need to search JSON but this is different from filters
                           // because we are going to sort by the users language not the builder's so the view will be sorted differntly depending on which languageCode
                           // you are using but the intent of the sort is maintained
                           var sortClause = "";
                           if (orderField.settings.supportMultilingual == 1) {
                              // TODO: move to ABOBjectExternal.js
                              if (
                                 !this.viewName && // NOTE: check if this object is a query, then it includes .translations already
                                 (orderField.object.isExternal ||
                                    orderField.object.isImported)
                              ) {
                                 let prefix = "";
                                 if (orderField.alias) {
                                    prefix = "{alias}".replace(
                                       "{alias}",
                                       orderField.alias
                                    );
                                 } else {
                                    prefix = "{databaseName}.{tableName}"
                                       .replace(
                                          "{databaseName}",
                                          orderField.object.dbSchemaName()
                                       )
                                       .replace(
                                          "{tableName}",
                                          orderField.object.dbTransTableName()
                                       );
                                 }

                                 sortClause = "`{prefix}.translations`".replace(
                                    "{prefix}",
                                    prefix
                                 );
                              } else {
                                 sortClause = 'JSON_UNQUOTE(JSON_EXTRACT(JSON_EXTRACT({prefix}.`translations`, SUBSTRING(JSON_UNQUOTE(JSON_SEARCH({prefix}.`translations`, "one", "{languageCode}")), 1, 4)), \'$."{columnName}"\'))'
                                    .replace(/{prefix}/g, orderField.dbPrefix())
                                    .replace(
                                       "{languageCode}",
                                       userData.languageCode
                                    )
                                    .replace(
                                       "{columnName}",
                                       orderField.columnName
                                    );
                              }
                           }
                           // If we are just sorting a field it is much simpler
                           else {
                              sortClause = "{prefix}.`{columnName}`"
                                 .replace("{prefix}", orderField.dbPrefix())
                                 .replace(
                                    "{columnName}",
                                    orderField.columnName
                                 );

                              // ABClassQuery:
                              // If this is query who create MySQL view, then column name does not have `
                              if (this.viewName) {
                                 sortClause =
                                    "`" + sortClause.replace(/`/g, "") + "`";
                              }
                           }
                           query.orderByRaw(sortClause + " " + o.dir);
                        });
                     }

                     // TODO : move to ABObjectExternal.js
                     // Special case
                     if (!this.viewName) {
                        // NOTE: check if this object is a query, then it includes .translations already
                        var multilingualFields = this.fields(
                           (f) =>
                              f.isMultilingual &&
                              (f.object.isExternal || f.object.isImported)
                        );
                        multilingualFields.forEach((f) => {
                           let whereRules = where.rules || [];
                           let sortRules = sort || [];

                           if (
                              whereRules.filter((r) => r.key == f.id)[0] ||
                              (sortRules.filter &&
                                 sortRules.filter((o) => o.key == f.id)[0])
                           ) {
                              let transTable = f.object.dbTransTableName();

                              let prefix = "";
                              let prefixTran = "";
                              let tableTran = "";
                              if (f.alias) {
                                 prefix = "{alias}".replace("{alias}", f.alias);
                                 prefixTran = "{alias}_Trans".replace(
                                    "{alias}",
                                    f.alias
                                 );
                                 tableTran = "{tableName} AS {alias}"
                                    .replace(
                                       "{tableName}",
                                       f.object.dbTransTableName(true)
                                    )
                                    .replace("{alias}", prefixTran);
                              } else {
                                 prefix = "{databaseName}.{tableName}"
                                    .replace(
                                       "{databaseName}",
                                       f.object.dbSchemaName()
                                    )
                                    .replace(
                                       "{tableName}",
                                       f.object.dbTableName()
                                    );
                                 prefixTran = "{databaseName}.{tableName}"
                                    .replace(
                                       "{databaseName}",
                                       f.object.dbSchemaName()
                                    )
                                    .replace("{tableName}", transTable);
                                 tableTran = f.object.dbTransTableName(true);
                              }

                              let baseClause = "{prefix}.{columnName}"
                                    .replace("{prefix}", prefix)
                                    .replace("{columnName}", f.object.PK()),
                                 connectedClause = "{prefix}.{columnName}"
                                    .replace("{prefix}", prefixTran)
                                    .replace(
                                       "{columnName}",
                                       f.object.transColumnName
                                    );

                              if (
                                 !(query._statements || []).filter(
                                    (s) => s.table == transTable
                                 ).length
                              )
                                 // prevent join duplicate
                                 query.innerJoin(
                                    tableTran,
                                    baseClause,
                                    "=",
                                    connectedClause
                                 );
                           }
                        });
                     }

                     // apply any offset/limit if provided.
                     if (offset) {
                        query.offset(offset);
                     }
                     if (limit) {
                        query.limit(limit);
                     }

                     // query relation data
                     if (query.eager) {
                        var relationNames = [],
                           excludeIds = [];

                        if (options.populate) {
                           this.connectFields()
                              .filter((f) => {
                                 return (
                                    (options.populate === true ||
                                       options.populate.indexOf(f.columnName) >
                                          -1) &&
                                    f.fieldLink != null
                                 );
                              })
                              .forEach((f) => {
                                 let relationName = f.relationName();

                                 // Exclude .id column by adding (unselectId) function name to .eager()
                                 if (
                                    f.datasourceLink &&
                                    f.datasourceLink.PK() === "uuid"
                                 ) {
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
                                    relationNames.push(
                                       f.relationName() + ".[translations]"
                                    );
                              });
                        }

                        // TODO: Move to ABObjectExternal
                        if (
                           !this.viewName &&
                           (this.isExternal || this.isImported) &&
                           this.transColumnName
                        ) {
                           relationNames.push("translations");
                        }

                        if (relationNames.length > 0) {
                           // console.log(relationNames);
                           query.eager(`[${relationNames.join(", ")}]`, {
                              // if the linked object's PK is uuid, then exclude .id
                              unselectId: (builder) => {
                                 builder.omit(["id"]);
                              },
                           });
                        }

                        // Exclude .id column
                        if (this.PK() === "uuid")
                           query.omit(this.model(), ["id"]);
                     }

                     this.selectFormulaFields(query);

                     // sails.log.debug('SQL:', query.toString() );

                     next();
                  })
            )
      );
   }
*/
   /**
    * @method pullScopes
    *
    * @param {Object} options - {
    *                   username: {string},
    *                   objectIds: {array},
    *                   ignoreQueryId: {uuid}
    *                }
    */
   pullScopes(options = {}) {
      return new Promise((resolve, reject) => {
         let ABObjectRole = this.AB.objectRole();

         // ABObjectRole.queryFind({
         ABObjectRole.model()
            .findAll({
               where: {
                  glue: "and",
                  rules: [
                     {
                        key: "users",
                        rule: "contains",
                        value: options.username,
                     },
                  ],
               },
               populate: true,
            })
            .then((roles) => {
               let scopes = [];

               (roles || []).forEach((r) => {
                  // Check user in role
                  if (
                     !(r.users || []).filter(
                        (u) => (u.id || u) == options.username
                     )[0]
                  )
                     return;

                  (r.scopes__relation || []).forEach((sData) => {
                     if (
                        !scopes.filter(
                           (s) => (s.id || s.uuid) == (sData.id || sData.uuid)
                        )[0]
                     )
                        scopes.push(sData);
                  });
               });

               // remove rules who has filter to query id
               if (options.ignoreQueryId) {
                  (scopes || []).forEach((s) => {
                     if (
                        !s ||
                        !s.filter ||
                        !s.filter.rules ||
                        s.filter.rules.length < 1
                     )
                        return;

                     s.filter.rules.forEach((r, rIndex) => {
                        if (
                           r.rule &&
                           (r.rule == "in_query" ||
                              r.rule == "not_in_query" ||
                              r.rule == "in_query_field" ||
                              r.rule == "not_in_query_field") &&
                           (r.value || "").indexOf(options.ignoreQueryId) > -1
                        ) {
                           s.filter.rules.splice(rIndex, 1);
                        }
                     });
                  });
               }

               resolve(scopes);
            })
            .catch(reject);
      });
   }

   /**
    * @method processFilterPolicy
    *
    * @return Promise
    */
   processFilterPolicy(_where, userData) {
      // list of all the condition filtering policies we want our defined
      // filters to pass through:
      const PolicyList = [
         require("../../policies/ABModelConvertSameAsUserConditions"),
         require("../../policies/ABModelConvertQueryConditions"),
         require("../../policies/ABModelConvertQueryFieldConditions"),
      ];

      // These older policies require an incoming req object with some
      // expected functionality.  The myReq is a mock object to mimic
      // those legacy features with our current capabilities.
      let myReq = {
         options: {
            _where: _where,
         },
         user: {
            data: userData,
         },
         param: (id) => {
            if (id == "appID") {
               console.error("appID being requested from processPolicy: WHY?");
               return this.application.id;
            } else if (id == "objID") {
               return this.id;
            }
         },
      };

      // run the options.where through our existing policy filters
      // get array of policies to run through
      let processPolicy = (indx, cb) => {
         if (indx >= PolicyList.length) {
            cb();
         } else {
            // load the policy
            let policy = PolicyList[indx];

            // run the policy on my data
            policy(myReq, {}, (err) => {
               if (err) {
                  cb(err);
               } else {
                  // try the next one
                  processPolicy(indx + 1, cb);
               }
            });
         }
      };

      return new Promise((resolve, reject) => {
         // run each One
         processPolicy(0, (err) => {
            // now that I'm through with updating our Conditions
            if (err) {
               reject(err);
            } else {
               resolve();
            }
         });
      });
   }

   selectFormulaFields(query) {
      // Formula fields
      let formulaFields = this.fields((f) => f.key == "formula");
      (formulaFields || []).forEach((f) => {
         let selectSQL = this.convertFormulaField(f);
         if (selectSQL) {
            // selectSQL += ` AS ${this.dbTableName(true)}.${f.columnName}`;
            selectSQL += ` AS \`${f.columnName}\``;
            query = query.select(
               this.AB.Knex.connection(/* connectionName */).raw(selectSQL)
            );
         }
      });

      // NOTE: select all columns
      if (formulaFields.length)
         query = query.select(`${this.dbTableName(true)}.*`);
   }

   convertFormulaField(formulaField) {
      if (formulaField == null || formulaField.key != "formula") return "";

      let settings = formulaField.settings || {};

      let connectedField = this.fields((f) => f.id == settings.field)[0];
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

      // M:1 , 1:1 isSource: false
      if (
         (connectedField.settings.linkType == "many" &&
            connectedField.settings.linkViaType == "one") ||
         (connectedField.settings.linkType == "one" &&
            connectedField.settings.linkViaType == "one" &&
            !connectedField.settings.isSource)
      ) {
         selectSQL = `(SELECT ${type[settings.type]}(\`${
            numberField.columnName
         }\`)
                  FROM ${connectedObj.dbTableName(true)}
                  WHERE ${connectedObj.dbTableName(true)}.\`${
            linkField.columnName
         }\` = ${this.dbTableName(true)}.\`${this.PK()}\`)`;
      }
      // 1:M , 1:1 isSource: true
      else if (
         (connectedField.settings.linkType == "one" &&
            connectedField.settings.linkViaType == "many") ||
         (connectedField.settings.linkType == "one" &&
            connectedField.settings.linkViaType == "one" &&
            connectedField.settings.isSource)
      ) {
         selectSQL = `(SELECT ${type[settings.type]}(\`${
            numberField.columnName
         }\`)
                  FROM ${connectedObj.dbTableName(true)}
                  WHERE ${connectedObj.dbTableName(
                     true
                  )}.\`${connectedObj.PK()}\` = ${this.dbTableName(true)}.\`${
            connectedField.columnName
         }\`)`;
      }
      // M:N
      else if (
         connectedField.settings.linkType == "many" &&
         connectedField.settings.linkViaType == "many"
      ) {
         let joinTable = connectedField.joinTableName(true),
            joinColumnNames = connectedField.joinColumnNames();

         selectSQL = `(SELECT ${type[settings.type]}(\`${
            numberField.columnName
         }\`)
               FROM ${connectedObj.dbTableName(true)}
               INNER JOIN ${joinTable}
               ON ${joinTable}.\`${
            joinColumnNames.targetColumnName
         }\` = ${connectedObj.dbTableName(true)}.${connectedObj.PK()}
               WHERE ${joinTable}.\`${
            joinColumnNames.sourceColumnName
         }\` = ${this.dbTableName(true)}.\`${this.PK()}\`)`;
      }

      return selectSQL;
   }

   convertConnectFieldCondition(field, condition) {
      let getCustomKey = (f, fCustomIndex) => {
         return "{prefix}.`{columnName}`"
            .replace("{prefix}", f.dbPrefix())
            .replace(
               "{columnName}",
               fCustomIndex ? fCustomIndex.columnName : f.object.PK()
            );
      };

      // M:1 or 1:1 (isSource == false)
      if (
         (field.settings.linkType == "many" &&
            field.settings.linkViaType == "one") ||
         (field.settings.linkType == "one" &&
            field.settings.linkViaType == "one" &&
            !field.settings.isSource)
      ) {
         condition.key = getCustomKey(field, field.indexField);
      }
      // M:N
      else if (
         field.settings.linkType == "many" &&
         field.settings.linkViaType == "many"
      ) {
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
         let joinTable = field.joinTableName();
         let sourceFkName = field.object.name;
         let targetFkName = fieldLink.object.name;

         let mnOperators = {
            contains: "LIKE",
            not_contains: "LIKE", // not NOT LIKE because we will use IN or NOT IN at condition.rule instead
            equals: "=",
            not_equal: "=", // same .not_contains
         };

         // create sub-query to get values from MN table
         condition.value =
            "(SELECT `{sourceFkName}` FROM `{joinTable}` WHERE `{targetFkName}` {ops} '{percent}{value}{percent}')"
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
            condition.rule == "contains" || condition.rule == "equals"
               ? "in"
               : "not_in";
      }
   }
};
