/*
 * ABFactory
 * an object that contains the definitions and references for a single tenant.
 * It is expected that an instance of this should be returned from an
 * ABBootstrap.init(req).then((AB)=>{}) call.
 */

const _ = require("lodash");
const EventEmitter = require("events").EventEmitter;
const path = require("path");
const uuidv4 = require("uuid");

const ABApplication = require("./platform/ABApplication");
const ABDefinition = require("./platform/ABDefinition");
const ABFieldManager = require("./core/ABFieldManager");
const ABIndex = require("./platform/ABIndex");
const ABObject = require(path.join(__dirname, "platform", "ABObject"));
// prettier-ignore
const ABObjectExternal = require(path.join(__dirname, "platform", "ABObjectExternal"));
// prettier-ignore
const ABObjectImport = require(path.join(__dirname, "platform", "ABObjectImport"));
const ABDataCollection = require("./platform/ABDataCollection");
// prettier-ignore
const ABObjectQuery = require(path.join(__dirname, "platform", "ABObjectQuery"));

const ABProcess = require("./platform/ABProcess");
const ABProcessParticipant = require("./platform/process/ABProcessParticipant");
const ABProcessLane = require("./platform/process/ABProcessLane");
const ABProcessTaskManager = require("./core/process/ABProcessTaskManager");

// const ABRole = require("../platform/ABRole");

const RowFilter = require("./platform/RowFilter");

class ABFactory extends EventEmitter {
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

      super();
      this.setMaxListeners(0);

      this._definitions = definitions;
      // {hash}  { ABDefinition.id : {ABDefinition} }

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

      //
      //
      // Manage our working objects
      //

      this._allApplications = [];
      // {array} of all the ABApplication(s) in our site.

      this._allObjects = [];
      // {array} of all the ABObject(s) in our site.

      this._allProcesses = [];
      // {array} of all the ABProcess(s) in our site.

      this._allQueries = [];
      // {array} of all the ABObjectQuery(s) in our site.

      this._allDatacollections = [];
      // {array} of all the ABDataCollection(s) in our site.

      //
      // Class References
      //
      this.Class = {
         ABObject,
         ABObjectExternal,
         ABObjectImport,
         ABObjectQuery,
         // ABRole      // Do we need this anymore?
      };

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
               var tenantDB = this.req.tenantDB();
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

               this._knexConn = require("knex")({
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
          * AB.rules.nameFilter
          * return a properly formatted name for an AppBuilder object.
          * @param {string} name
          *        The name of the object we are conditioning.
          * @return {string}
          */
         nameFilter: function (name) {
            return String(name).replace(/[^a-z0-9]/gi, "");
         },

         /**
          * AB.rules.toApplicationNameFormat
          * return a properly formatted Application Name
          * @param {string} name
          *        The name of the Application we are conditioning.
          * @return {string}
          */
         toApplicationNameFormat: function (name) {
            return "AB_" + this.nameFilter(name);
         },

         /**
          * AB.rules.toJunctionTableFK
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
          * AB.rules.toJunctionTableNameFormat
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
      };

      this.init();
   }

   init() {
      let allDefinitions = Object.keys(this._definitions).map(
         (k) => this._definitions[k]
      );
      // {array} all our definitions in an Array format.

      // make sure our definitions.json field is an {} and not string
      allDefinitions.forEach((d) => {
         if (typeof d.json == "string") {
            try {
               d.json = JSON.parse(d.json);
            } catch (e) {
               console.log(e);
            }
         }
      });

      //
      // Prepare our Objects
      //
      let allObjects = allDefinitions.filter((def) => {
         return def.type == "object";
      });
      (allObjects || []).forEach((defObj) => {
         this._allObjects.push(this.objectNew(defObj.json));
      });

      //
      // Prepare our Queries
      //
      let allQueries = allDefinitions.filter((def) => {
         return def.type == "query";
      });
      (allQueries || []).forEach((defQry) => {
         this._allQueries.push(this.queryNew(defQry.json));
      });

      //
      // Prepare our DataCollections
      //
      let allDCs = allDefinitions.filter((def) => {
         return def.type == "datacollection";
      });
      (allDCs || []).forEach((def) => {
         this._allDatacollections.push(this.datacollectionNew(def.json));
      });

      //
      // Prepare our Processes
      //
      let allProcesses = allDefinitions.filter((def) => {
         return def.type == "process";
      });
      (allProcesses || []).forEach((def) => {
         this._allProcesses.push(this.processNew(def.json));
      });

      //
      // Prepare our Applications
      //
      let appDefs = allDefinitions.filter((def) => {
         return def.type == "application";
      });
      appDefs.forEach((app) => {
         this._allApplications.push(this.applicationNew(app.json));
      });
   }

   //
   // Definitions
   //
   definition(id) {
      var errDepreciated = new Error(
         "ABFactory.definition() is Depreciated.  Use .definitionForID() instead."
      );
      console.error(errDepreciated);

      return this.definitionForID(id);
   }

   /**
    * definiitonCreate(def)
    * create a new ABDefinition
    * @param {obj} def
    *        the value hash of the new definition entry
    * @return {Promise}
    *        resolved with a new {ABDefinition} for the entry.
    */
   definitionCreate(def) {
      return this.Definitions.Create(this.req, def).then((fullDef) => {
         let newDef = this.definitionNew(fullDef);
         this.emit("definition.created", newDef);
         return newDef;
      });
   }

   /**
    * definitionDestroy(id)
    * delete an ABDefinition
    * @param {string} id
    *        the uuid of the ABDefinition to delete
    * @return {Promise}
    */
   definitionDestroy(id) {
      return this.Definitions.Destroy(this.req, id).then(() => {
         delete this._definitions[id];
         this.emit("definition.destroyed", id);
      });
   }

   /**
    * definitionForID(id)
    * return an ABDefinition.json value ready for our objects to use.
    * @param {string} id
    *        the uuid of the ABDefinition to delete
    * @param {bool} isRaw
    *        indicates if we want the full ABDefinition, or the .json param
    *        true : returns full ABDefinition value.
    *        false: returns the .json parameter used by most ABObjects.
    * @return {Promise}
    */
   definitionForID(id, isRaw = false) {
      if (this._definitions[id]) {
         if (isRaw) {
            return this._definitions[id];
         } else {
            return this._definitions[id].json;
         }
      }
      return null;
   }

   /**
    * definitionNew(values)
    * return an ABDefinition object tied to this Tenant.
    * @param {obj} values
    *        The value hash of the ABDefinition object to create.
    * @return {ABDefinition}
    */
   definitionNew(values) {
      return new ABDefinition(values, this);
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
   definitionUpdate(id, values) {
      return this.Definitions.Update(this.req, { id }, values).then(() => {
         this.emit("definition.updated", id);
      });
   }

   //
   // ABObjects
   //
   applications(fn = () => true) {
      return (this._allApplications || []).filter(fn);
   }

   applicationNew(values) {
      return new ABApplication(values, this);
   }

   /**
    * @method datacollections()
    * return an array of all the ABDataCollection for this ABApplication.
    * @param {fn} filter
    *        a filter fn to return a set of ABDataCollection that
    *        this fn returns true for.
    * @return {array}
    *        array of ABDataCollection
    */
   datacollections(filter = () => true) {
      return (this._allDatacollections || []).filter(filter);
   }

   /**
    * @method datacollectionByID()
    * returns a single ABDatacollection that matches the given ID.
    * @param {string} ID
    *        the .id/.name/.label of the ABDatacollection we are searching
    *        for.
    * @return {ABDatacollection}
    *        the matching ABDatacollection object if found
    *        {null} if not found.
    */
   datacollectionByID(ID) {
      // an undefined or null ID should not match any DC.
      if (!ID) return null;

      return this.datacollections((dc) => {
         return dc.id == ID || dc.name == ID || dc.label == ID;
      })[0];
   }

   /**
    * @method datacollectionNew()
    * create a new instance of ABDataCollection
    * @param {obj} values
    *        the initial values for the DC
    * @return {ABDatacollection}
    */
   datacollectionNew(values) {
      var dc = new ABDataCollection(values, this);
      dc.on("destroyed", () => {
         // make sure it is no longer in our internal list
         this._allDatacollections = this._allDatacollections.filter(
            (d) => d.id != dc.id
         );
      });
      return dc;
   }

   /**
    * @method fieldNew()
    * return an instance of a new (unsaved) ABField that is tied to a given
    * ABObject.
    * NOTE: this new field is not included in our this.fields until a .save()
    * is performed on the field.
    * @param {obj} values  the initial values for this field.
    *                - { key:'{string}'} is required
    * @param {ABObject} object  the parent object this field belongs to.
    * @return {ABField}
    */
   fieldNew(values, object) {
      // NOTE: ABFieldManager returns the proper ABFieldXXXX instance.
      return ABFieldManager.newField(values, object);
   }

   /**
    * @method indexNew()
    * return an instance of a new (unsaved) ABIndex.
    * @return {ABIndex}
    */
   indexNew(values, object) {
      return new ABIndex(values, object);
   }

   /**
    * @method objects()
    * return an array of all the ABObjects for this ABApplication.
    * @param {fn} filter
    *        a filter fn to return a set of ABObjects that this fn
    *        returns true for.
    * @return {array}
    *        array of ABObject
    */
   objects(filter = () => true) {
      return (this._allObjects || []).filter(filter);
   }

   /**
    * @method objectByID()
    * return the specific object requested by the provided id.
    * @param {string} ID
    * @return {obj}
    */
   objectByID(ID) {
      return this.objects((o) => {
         return o.id == ID || o.name == ID || o.label == ID;
      })[0];
   }

   /**
    * @method objectNew()
    * return an instance of a new (unsaved) ABObject that is tied to this
    * ABApplication.
    * NOTE: this new object is not included in our this.objects until a .save()
    * is performed on the object.
    * @return {ABObject}
    */
   objectNew(values) {
      if (values.isExternal == true) return new ABObjectExternal(values, this);
      else if (values.isImported == true)
         return new ABObjectImport(values, this);
      else return new ABObject(values, this);
   }

   objectRole() {
      return this.objectByID("c33692f3-26b7-4af3-a02e-139fb519296d");
   }

   objectScope() {
      return this.objectByID("af10e37c-9b3a-4dc6-a52a-85d52320b659");
   }

   objectUser() {
      return this.objectByID("228e3d91-5e42-49ec-b37c-59323ae433a1");
   }

   processes(filter = () => true) {
      return (this._allProcesses || []).filter(filter);
   }

   processNew(id) {
      var processDef = this.definitionForID(id);
      if (processDef) {
         return new ABProcess(processDef, this);
      }
      return null;
   }

   /**
    * @method processElementNew(id)
    * return an instance of a new ABProcessOBJ that is tied to a given
    * ABProcess.
    * @param {string} id
    *        the ABDefinition.id of the element we are creating
    * @param {ABProcess} process
    *        the process this task is a part of.
    * @return {ABProcessTask}
    */
   processElementNew(id, process) {
      var taskDef = this.definitionForID(id);
      if (taskDef) {
         switch (taskDef.type) {
            case ABProcessParticipant.defaults().type:
               return new ABProcessParticipant(taskDef, process, this);
            // break;

            case ABProcessLane.defaults().type:
               return new ABProcessLane(taskDef, process, this);
            // break;

            default:
               // default to a Task
               return ABProcessTaskManager.newTask(taskDef, process, this);
            // break;
         }
      }
      return null;
   }

   /**
    * @method queries()
    * return an array of all the ABObjectQuery(s).
    * @param {fn} filter
    *        a filter fn to return a set of ABObjectQuery(s) that this fn
    *        returns true for.
    * @return {array}
    *        array of ABObjectQuery
    */
   queries(filter = () => true) {
      return (this._allQueries || []).filter(filter);
   }
   queriesAll() {
      console.error(
         "ABFactory.queriesAll() Depreciated! Use .queries() instead. "
      );
      return this.queries();
   }

   /**
    * @method queryByID()
    * return the specific query requested by the provided id.
    * NOTE: this method has been extended to allow .name and .label
    * as possible lookup values.
    * @param {string} ID
    * @return {ABObjectQuery}
    */
   queryByID(ID) {
      return this.queries((q) => {
         return q.id == ID || q.name == ID || q.label == ID;
      })[0];
   }

   /**
    * @method queryNew()
    * return an instance of a new (unsaved) ABObjectQuery that is tied to this
    * ABFactory.
    * @return {ABObjectQuery}
    */
   queryNew(values) {
      return new ABObjectQuery(values, this);
   }

   /**
    * @method rowfilterNew()
    * return an instance of a new RowFilter that is tied to this
    * ABFactory.
    * @return {RowFilter}
    */
   rowfilterNew(App, idBase) {
      return new RowFilter(App, idBase, this);
   }

   //
   // Utilities
   //
   cloneDeep(value) {
      return _.cloneDeep(value);
   }

   error(message) {
      console.error(`ABFactory[${this.req.tenantID()}]:${message.toString()}`);
      if (message instanceof Error) {
         console.error(message);
      }
      this.emit("error", message);
   }

   uuid() {
      return uuidv4();
   }

   toJSON() {
      return { tenantID: this.req.tenantID() };
   }
}

module.exports = ABFactory;
