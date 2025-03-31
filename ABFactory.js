/*
 * ABFactory
 * an object that contains the definitions and references for a single tenant.
 * It is expected that an instance of this should be returned from an
 * ABBootstrap.init(req).then((AB)=>{}) call.
 */

const _ = require("lodash");
const Knex = require("knex");
const moment = require("moment");
const nanoid = require("nanoid");
const { serializeError, deserializeError } = require("serialize-error");
const uuid = require("uuid");

var ABFactoryCore = require("./core/ABFactoryCore");

function stringifyErrors(param) {
   if (param instanceof Error) {
      return serializeError(param);
   }

   // traverse given data structure:
   if (Array.isArray(param)) {
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
   constructor(definitions, DefinitionManager, req, knexConnection = null) {
      /**
       * @param {hash} definitions
       *        { ABDefinition.id : {ABDefinition} }
       *        of all the definitions defined for the current Tenant
       * @param {obj} DefinitionManager
       *        an interface for how to perform CRUD operations on definitions
       *        for this platform.
       *        Should Expose:
       *          DefinitionManager.Create(req, values)
       *          DefinitionManager.Destroy(req, cond);
       *          DefinitionManager.Find(req, cond);
       *          DefinitionManager.Update(req, cond, values);
       * @param {ABUtil.request} req
       *        A req object tied to the proper tenant for this Factory.
       *        Should be created by the service (Bootstrap.js) when it
       *        needs to communicate to a tenant.
       * @param {ABFactory.Knex.connection()} knexConnection
       *        An existing Knex Connection to reuse for this Factory.
       *        (optional)
       */

      super(definitions);

      this.Definitions = DefinitionManager;
      // {obj} the provided interface for working with the ABDefinition table.

      this.req = req;
      // {ABUtils.request} a tenant aware request object for interacting with
      // the data in our Tenant's db.

      this._knexConn = knexConnection;
      // {Knex}
      // an instance of a {Knex} object that is tied to this Tenant's MySQL
      // connection settings. The base definition is found in config/local.js
      // and can be returned by the this.req object.

      this.__ModelPool = {};
      // {hash} { modelName : Knex.connection() }
      // This is a cached Objection(knex) cache of our Object Models for
      // interacting with our DB tables using Objection.js

      this.__Cache = {};
      // {hash} { serviceKey : { serviceCacheData } }
      // allow a service to store temporary cache information associated
      // with the current ABFactory.  This data is only around as long as
      // this factory is.

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
                     max: config.poolMax || 30,
                     // this should reduce Knex Timeout Errors
                     // (https://github.com/knex/knex/issues/2820)
                     acquireTimeoutMillis: config.acquireTimeout || 90000,
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
      const platformRules = {
         /**
          * @method AB.rules.toSQLDate
          * return a properly formatted DateTime string for MYSQL 5.7 but ignore the time information
          * @param {string} date  String of a date you want converted
          * @return {string}
          */
         toSQLDate: function (date) {
            return moment(date).format("YYYY-MM-DD");
            // return moment(date).format("YYYY-MM-DD 00:00:00");
         },

         /**
          * @method AB.rules.toSQLDateTime
          * return a properly formatted DateTime string for MYSQL 5.7
          * @param {string} date  String of a date you want converted
          * @return {string}
          */
         toSQLDateTime: function (date) {
            return moment(date).utc().format("YYYY-MM-DD HH:mm:ss");
         },

         /**
          * @method AB.rules.toDate
          * return the given string as a Date object.
          * @param {string} dateText
          * @param {Object} options
          *        {
          *           format: "string",
          *           ignoreTime: boolean
          *        }
          * @return {Date}
          */
         toDate(dateText = "", options = {}) {
            if (!dateText) return;

            if (options.ignoreTime) dateText = dateText.replace(/T.*/, "");

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
          * @method AB.rules.toDateFormat
          * convert a {Date} into a string representation we recognize.
          * @param {Date} date
          * @param {Object} options -
          *        {
          *           format: "string",
          *           localeCode: "string"
          *        }
          * @return {string}
          */
         toDateFormat(date, options) {
            if (!date) return "";

            let momentObj = moment(date);

            if (options.localeCode) momentObj.locale(options.localeCode);

            return momentObj.format(options.format);
         },

         /**
          * @method AB.rules.subtractDate
          * return a {Date} object representing a date that is a number of units
          * before the given date.
          * @param {Date} date
          * @param {number} number
          * @param {string} unit
          * @return {Date}
          */
         subtractDate(date, number, unit) {
            return moment(date).subtract(number, unit).toDate();
         },

         /**
          * @method AB.rules.addDate
          * return a {Date} object representing a date that is a number of units
          * after the given date.
          * @param {Date} date
          * @param {number} number
          * @param {string} unit
          * @return {Date}
          */
         addDate(date, number, unit) {
            return moment(date).add(number, unit).toDate();
         },

         /**
          * Get today's UTC time range in "YYYY-MM-DD HH:MM:SS" format.
          *
          * It converts the start and end of today to UTC to keep things consistent
          * across time zones. Handy when you need to deal with dates in different regions.
          *
          * @returns {string} UTC time range for today.
          */

         getUTCDayTimeRange: () => {
            let now = new Date();
            let year = now.getFullYear();
            let month = now.getMonth();
            let date = now.getDate();
            let startOfDay = new Date(year, month, date, 0, 0, 0);
            let endOfDay = new Date(year, month, date, 23, 59, 59);

            // Convert to UTC by subtracting the timezone offset
            let startOfDayUTC = new Date(
               startOfDay.getTime() + startOfDay.getTimezoneOffset() * 60000
            );
            let endOfDayUTC = new Date(
               endOfDay.getTime() + endOfDay.getTimezoneOffset() * 60000
            );

            //  Format the date in "YYYY-MM-DD HH:MM:SS" format
            let formatDate = (date) => {
               let isoString = date.toISOString();
               return `${isoString.slice(0, 10)} ${isoString.slice(11, 19)}`;
            };
            return formatDate(startOfDayUTC).concat(
               "|",
               formatDate(endOfDayUTC)
            );
         },
      };
      (Object.keys(platformRules) || []).forEach((k) => {
         this.rules[k] = platformRules[k];
      });
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
    * definiitonCreate()
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
    * definitionDestroy()
    * delete an ABDefinition
    * @param {string} id
    *        the uuid of the ABDefinition to delete
    * @return {Promise}
    */
   definitionDestroy(req, id, options = {}) {
      return this.Definitions.Destroy(this, req, { id }, options).then(() => {
         delete this._definitions[id];
         this.emit("definition.destroyed", id);
      });
   }

   /**
    * definitionFind()
    * return the definitions that match the provided condition.
    * @param {string} id
    *        the uuid of the ABDefinition to delete
    * @return {Promise}
    */
   definitionFind(req, cond, options = {}) {
      return this.Definitions.Find(this, req, cond, options);
   }

   /**
    * definitionUpdate()
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
         (rows) => {
            let newDef = this.definitionNew(rows[0] || rows);
            this._definitions[id] = newDef;
            this.emit("definition.updated", id);
            return newDef;
         }
      );
   }

   //
   // Cached Data
   //

   /**
    * @method cache()
    * provide an interface for a service to store cached data.
    * This data persists as long as the current ABFactory exists.
    * @param {string} key
    *        The unique key to retrieve the cached data.
    * @param {various} data
    *        Any type of data you want to store.
    * @return {undefined | various}
    */
   cache(key, data) {
      if (typeof data != "undefined") {
         this.__Cache[key] = data;
         return;
      }
      return this.__Cache[key];
   }

   /**
    * @method cacheClear()
    * provide an interface for a service to clear cached data.
    * @param {string} key
    *        The unique key to retrieve the cached data.
    * @return {undefined}
    */
   cacheClear(key) {
      delete this.__Cache[key];
   }

   /**
    * @method cacheMatch()
    * this lets you work with a set of cached entries whose keys match the provided key.
    * This is useful for updating a number of cached entries at a time.
    * @param {string} key
    *        The searchKey to set/retrieve the cached data.
    * @return {undefined | various}
    */
   cacheMatch(key, data) {
      let matches = Object.keys(this.__Cache).filter(
         (k) => k.indexOf(key) > -1
      );
      if (typeof data != "undefined") {
         matches.forEach((k) => {
            this.cache(k, data);
         });
      } else {
         let response = {};
         matches.forEach((k) => {
            response[k] = this.cache(k);
         });
         return response;
      }
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
   clone(value) {
      return _.clone(value);
   }

   cloneDeep(value) {
      return _.cloneDeep(value);
   }

   defaultSystemRoles() {
      return [
         "dd6c2d34-0982-48b7-bc44-2456474edbea", // System Admin
         "6cc04894-a61b-4fb5-b3e5-b8c3f78bd331", // Sytem Builder
         "e1be4d22-1d00-4c34-b205-ef84b8334b19", // Builder
      ];
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

   isNil(value) {
      return _.isNil(value);
   }

   isUndefined(...params) {
      return _.isUndefined(...params);
   }

   jobID(length = 21) {
      return nanoid(length);
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
