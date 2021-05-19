/*
 * ABFactory
 * an object that contains the definitions and references for a single tenant.
 * It is expected that an instance of this should be returned from an
 * ABBootstrap.init(req).then((AB)=>{}) call.
 */

const _ = require("lodash");
const Knex = require("knex");
const moment = require("moment");
const { serializeError, deserializeError } = require("serialize-error");
const uuid = require("uuid");

var ABFactoryCore = require("./core/ABFactoryCore");

function stringifyErrors(param) {
   if (param instanceof Error) {
      return serializeError(param);
   }

   // traverse given data structure:
   if (typeof param == "array") {
      for (var i = 0; i < param.length; i++) {
         param[i] = stringifyErrors(param[i]);
      }
   } else if (param && typeof param == "object") {
      // maybe one of my Keys are an Error Object:
      Object.keys(param).forEach((k) => {
         param[k] = stringifyErrors(param[k]);
      });
   }

   return param;
}

class ABFactory extends ABFactoryCore {
   constructor(definitions, DefinitionManager, req) {
      /**
       * @param {hash} definitions
       *        { ABDefinition.id : {ABDefinition} }
       *        of all the definitions defined for the current Tenant
       * @param {obj} DefinitionManager
       *        an interface for how to perform CRUD operations on definitions
       *        for this platform.
       *        Should Expose:
       *          DefinitionManager.Create(req, values)
       *          DefinitionManager.Destroy(req, id);
       *          DefinitionManager.Find(req, cond);
       *          DefinitionManager.Update(req, cond, values);
       * @param {ABUtil.request} req
       *        A req object tied to the proper tenant for this Factory.
       *        Should be created by the
       */

      super(definitions);

      this.Definitions = DefinitionManager;
      // {obj} the provided interface for working with the ABDefinition table.

      this.req = req;
      // {ABUtils.request} a tenant aware request object for interacting with
      // the data in our Tenant's db.

      this._knexConn = null;
      // {Knex}
      // an instance of a {Knex} object that is tied to this Tenant's MySQL
      // connection settings. The base definition is found in config/local.js
      // and can be returned by the this.req object.

      this.__ModelPool = {};
      // {hash} { modelName : Knex.connection() }
      // This is a cached Objection(knex) cache of our Object Models for
      // interacting with our DB tables using Objection.js

      //
      // Config Data
      //
      this.config = {
         // connections: {}  // TODO:
      };

      //
      // Knex: Migration utilities
      //
      this.Knex = {
         /**
          * @method AB.Knex.connection(name);
          * return a configured {Knex} object used for generating
          * sql statements against a Tenant's DB.
          * @param {string} name
          *        the configuration entry representing the MySql connection
          *        settings that are stored in config/local.js
          *        ( for now, the plan is that all tenant DBs are stored in the
          *        same MySql instance.  However it is possible that a Tenant's
          *        settings might differ and we eventually spread them out across
          *        different mysql instances)
          * @return {Knex}
          */
         connection: () => {
            if (!this._knexConn) {
               // NOTE: .tenantDB() returns the db name enclosed with ` `
               // our KNEX connection doesn't want that for the DB Name:
               var tenantDB = this.req.tenantDB().replaceAll("`", "");
               if (!tenantDB) {
                  throw new Error(
                     `ABFactory.Knex.connection(): Could not find Tenant DB information for id[${this.req.tenantID()}]`
                  );
               }
               var config = this.req.connections()["appbuilder"];
               if (!config) {
                  throw new Error(
                     `ABFactory.Knex.connection(): Could not find configuration settings`
                  );
               }

               this._knexConn = Knex({
                  client: "mysql",
                  connection: {
                     host: config.host,
                     user: config.user,
                     port: config.port,
                     password: config.password,
                     database: tenantDB,
                     timezone: "UTC",
                  },
                  // FIX : ER_CON_COUNT_ERROR: Too many connections
                  // https://github.com/tgriesser/knex/issues/1027
                  pool: {
                     min: 2,
                     max: 20,
                  },
               });
            }

            return this._knexConn;
         },

         /**
          * @method AB.Knex.createTransaction
          * create Knex.Transaction.
          * There are 2 expected ways to call this method:
          * @codestart
          *    AB.Knex.createTransaction((trx)=>{
          *       // you can use the Transaction object (trx) now
          *    })
          * @codeend
          * or using the promise:
          * @codestart
          *    AB.Knex.createTransaction().then((trx)=>{
          *       // you can use the Transaction object (trx) now
          *    })
          * @codeend
          * @param {function} - callback
          *        a callback to receive the newly created {Knex.transaction}
          *        object.
          * @return {Promise} - resolve(Knex.Transaction)
          */
         createTransaction: (callback) => {
            let knex = this.Knex.connection();
            return knex.transaction(callback);
         },
      };

      //
      // Rules
      //
      this.rules = {
         /**
          * @method rules.isUUID
          * evaluate a given value to see if it matches the format of a uuid
          * @param {string} key
          * @return {boolean}
          */
         isUUID: function (key) {
            var checker = RegExp(
               "^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
               "i"
            );
            return checker.test(key);
         },

         /**
          * AB.rules.nameFilter()
          * return a properly formatted name for an AppBuilder object.
          * @param {string} name
          *        The name of the object we are conditioning.
          * @return {string}
          */
         nameFilter: function (name) {
            return String(name).replace(/[^a-z0-9]/gi, "");
         },

         /**
          * AB.rules.toApplicationNameFormat()
          * return a properly formatted Application Name
          * @param {string} name
          *        The name of the Application we are conditioning.
          * @return {string}
          */
         toApplicationNameFormat: function (name) {
            return "AB_" + this.nameFilter(name);
         },

         /**
          * AB.rules.toFieldRelationFormat()
          *
          * This function uses for define relation name of Knex Objection
          * return a relation name of column
          *
          * @param {string} colName  The name of the Column
          * @return {string}
          */
         toFieldRelationFormat: function (colName) {
            return this.nameFilter(colName) + "__relation";
         },

         /**
          * AB.rules.toJunctionTableFK()
          * return foriegnkey (FK) column name for a junction table name
          * @param {string} objectName
          *        The name of the Object with a connection
          * @param {string} columnName
          *        The name of the connection columnName.
          * @return {string}
          */
         toJunctionTableFK: function (objectName, columnName) {
            var fkName = objectName + "_" + columnName;

            if (fkName.length > 64) fkName = fkName.substring(0, 64);

            return fkName;
         },

         /**
          * AB.rules.toJunctionTableNameFormat()
          * return many-to-many junction table name
          * @param {string} appName
          *        The name of the Application for this object
          * @param {string} sourceTableName
          *        The name of the source object we are conditioning.
          * @param {string} targetTableName
          *        The name of the target object we are conditioning.
          * @param {string} colName
          * @return {string}
          */
         toJunctionTableNameFormat: function (
            appName,
            sourceTableName,
            targetTableName,
            colName
         ) {
            // The maximum length of a table name in MySql is 64 characters
            appName = this.toApplicationNameFormat(appName);
            if (appName.length > 17) appName = appName.substring(0, 17);

            if (sourceTableName.length > 15)
               sourceTableName = sourceTableName.substring(0, 15);

            if (targetTableName.length > 15)
               targetTableName = targetTableName.substring(0, 15);

            colName = this.nameFilter(colName);
            if (colName.length > 14) colName = colName.substring(0, 14);

            return "{appName}_{sourceName}_{targetName}_{colName}"
               .replace("{appName}", appName)
               .replace("{sourceName}", sourceTableName)
               .replace("{targetName}", targetTableName)
               .replace("{colName}", colName);
         },

         /**
          * AppBuilder.rules.toSQLDate
          *
          * return a properly formatted DateTime string for MYSQL 5.7 but ignore the time information
          *
          * @param {string} date  String of a date you want converted
          * @return {string}
          */
         toSQLDate: function (date) {
            return moment(date).format("YYYY-MM-DD");
            // return moment(date).format("YYYY-MM-DD 00:00:00");
         },

         /**
          * AppBuilder.rules.toSQLDateTime
          *
          * return a properly formatted DateTime string for MYSQL 5.7
          *
          * @param {string} date  String of a date you want converted
          * @return {string}
          */
         toSQLDateTime: function (date) {
            return moment(date).utc().format("YYYY-MM-DD HH:mm:ss");
         },

         /**
          * @method toDate
          *
          * @param {string} dateText
          * @param {Object} options - {
          *                               format: "string",
          *                               ignoreTime: boolean
          *                            }
          * @return {Date}
          */
         toDate(dateText = "", options = {}) {
            if (!dateText) return;

            if (options.ignoreTime) dateText = dateText.replace(/\T.*/, "");

            let result = options.format
               ? moment(dateText, options.format)
               : moment(dateText);

            let supportFormats = [
               "YYYY-MM-DD",
               "YYYY/MM/DD",
               "DD/MM/YYYY",
               "MM/DD/YYYY",
               "DD-MM-YYYY",
               "MM-DD-YYYY",
            ];

            supportFormats.forEach((format) => {
               if (!result || !result.isValid())
                  result = moment(dateText, format);
            });

            return new Date(result);
         },

         /**
          * @method toDateFormat
          *
          * @param {Date} date
          * @param {Object} options - {
          *                               format: "string",
          *                               localeCode: "string"
          *                            }
          *
          * @return {string}
          */
         toDateFormat(date, options) {
            if (!date) return "";

            let momentObj = moment(date);

            if (options.localeCode) momentObj.locale(options.localeCode);

            return momentObj.format(options.format);
         },

         /**
          * @method subtractDate
          *
          * @param {Date} date
          * @param {number} number
          * @param {string} unit
          *
          * @return {Date}
          */
         subtractDate(date, number, unit) {
            return moment(date).subtract(number, unit).toDate();
         },

         /**
          * @method addDate
          *
          * @param {Date} date
          * @param {number} number
          * @param {string} unit
          *
          * @return {Date}
          */
         addDate(date, number, unit) {
            return moment(date).add(number, unit).toDate();
         },
      };
   }

   // init() {
   // super.init().then(()=>{
   //    // perform any local setups here.
   // });
   // }

   //
   // Definitions
   //

   /**
    * definiitonCreate(def)
    * create a new ABDefinition
    * @param {obj} def
    *        the value hash of the new definition entry
    * @return {Promise}
    *        resolved with a new {ABDefinition} for the entry.
    */
   definitionCreate(req, def, options = {}) {
      return this.Definitions.Create(this, req, def, options).then(
         (fullDef) => {
            let newDef = this.definitionNew(fullDef);
            this.emit("definition.created", newDef);
            return newDef;
         }
      );
   }

   /**
    * definitionDestroy(id)
    * delete an ABDefinition
    * @param {string} id
    *        the uuid of the ABDefinition to delete
    * @return {Promise}
    */
   definitionDestroy(req, id, options = {}) {
      return this.Definitions.Destroy(this, req, id, options).then(() => {
         delete this._definitions[id];
         this.emit("definition.destroyed", id);
      });
   }

   /**
    * definitionUpdate(id, def)
    * update an existing ABDefinition
    * @param {string} id
    *        the uuid of the ABDefinition to update.
    * @param {obj} def
    *        the value hash of the new definition values
    * @return {Promise}
    *        resolved with a new {ABDefinition} for the entry.
    */
   definitionUpdate(req, id, values, options = {}) {
      return this.Definitions.Update(this, req, { id }, values, options).then(
         () => {
            this.emit("definition.updated", id);
         }
      );
   }

   /**
    * @method modelPool()
    * return the cached Model connection for the given modelName.
    * @param {string} modelName
    *        the name of the model connection we are requesting.
    *        (this is assigned by the ABModel object)
    * @return {Objection Model Connection}
    */
   modelPool(modelName) {
      return this.__ModelPool[modelName];
   }

   /**
    * @method modelPoolDelete()
    * remove the current cached Model connection.
    * @param {string} modelName
    *        the name of the model connection we are requesting.
    *        (this is assigned by the ABModel object)
    */
   modelPoolDelete(modelName) {
      delete this.__ModelPool[modelName];
   }

   /**
    * @method modelPoolSet()
    * store the cached Model connection for the given modelName.
    * This is set by the ABModel Object
    * @param {string} modelName
    *        the name of the model connection we are requesting.
    *        (this is assigned by the ABModel object)
    * @param {ConnectionModel} Model
    * @return {Objection Model Connection}
    */
   modelPoolSet(modelName, Model) {
      this.__ModelPool[modelName] = Model;
   }

   //
   // Communications
   //

   /**
    * notify()
    * will send alerts to a group of people. These alerts are usually about
    * configuration errors, or software problems.
    * @param {string} domain
    *     which group of people we are sending a notification to.
    * @param {Error} error
    *     An error object generated at the point of issue.
    * @param {json} info
    *     Additional related information concerning the issue.
    */
   notify(domain, error, info) {
      return this.req.notify(domain, error, this._notifyInfo(info));
   }

   //
   // Utilities
   //
   cloneDeep(value) {
      return _.cloneDeep(value);
   }

   error(message) {
      message = deserializeError(message);
      console.error(`ABFactory[${this.req.tenantID()}]:${message.toString()}`);
      if (message instanceof Error) {
         console.error(message);
      }
      this.emit("error", message);
   }

   toError(...params) {
      var error = new Error(params.shift() || "Error:");
      if (params.length > 0) {
         // replace Error objects with a string that can be passed over the
         // wire and deserialize later.
         stringifyErrors(params);
         error._context = JSON.stringify(params);
      }
      return error;
   }

   isEmpty(...params) {
      return _.isEmpty(...params);
   }

   isUndefined(...params) {
      return _.isUndefined(...params);
   }

   merge(...params) {
      return _.merge(...params);
   }

   orderBy(...params) {
      return _.orderBy(...params);
   }

   uniq(...params) {
      return _.uniq(...params);
   }

   uuid() {
      return uuid.v4();
   }

   toJSON() {
      return { tenantID: this.req.tenantID() };
   }
}

module.exports = ABFactory;
