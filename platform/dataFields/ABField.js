/*
 * ABField
 *
 * An ABField defines a single unique Field/Column in a ABObject.
 *
 */
var _ = require("lodash");
var path = require("path");

// prettier-ignore
var ABFieldCore = require(path.join(__dirname, "..", "..", "core", "dataFields", "ABFieldCore.js"));

function L(key, altText) {
   return altText; // AD.lang.label.getLabel(key) || altText;
}

module.exports = class ABField extends ABFieldCore {
   constructor(values, object, fieldDefaults) {
      super(values, object, fieldDefaults);

      /*
  		{
  			id:'uuid',					// uuid value for this obj
  			key:'fieldKey',				// unique key for this Field
  			icon:'font',				// fa-[icon] reference for an icon for this Field Type
  			label:'',					// pulled from translation
			columnName:'column_name',	// a valid mysql table.column name
			isImported: 1/0,			// flag to mark is import from other object
			settings: {					// unique settings for the type of field
				showIcon:true/false,	// only useful in Object Workspace DataTable
				isImported: 1/0,		// flag to mark is import from other object
				required: 1/0,			// field allows does not allow NULL or it does allow NULL
				width: {int}			// width of display column

				// specific for dataField
			},
			translations:[]
  		}
		  */
   }

   ///
   /// DB Migrations
   ///

   dbPrefix() {
      var result;

      // add alias to be prefix
      if (this.alias) {
         result = "`{alias}`".replace("{alias}", this.alias);
      }
      // add database and table names to be prefix
      else {
         // for local Objects, we want to include {db}.{table}
         if (!this.object.isAPI) {
            result = "`{databaseName}`.`{tableName}`"
               .replace("{databaseName}", this.object.dbSchemaName())
               .replace("{tableName}", this.object.dbTableName());
         } else {
            // for API based objects, we only reuse {table}
            result = this.object.dbTableName();
         }
      }

      return result;
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
      data.ids.push(this.id);
   }

   /**
    * @method exportIDs()
    * export any relevant .ids for the necessary operation of this application.
    * @param {array} ids
    *        the array of ids to store our relevant .ids into
    */
   exportIDs(ids) {
      ids.push(this.id);
   }

   /**
    * @function migrateCreate
    * perform the necessary sql actions to ADD this column to the DB table.
    * @param {ABUtil.reqService} req
    *        the request object for the job driving the migrateCreate().
    * @param {knex} knex
    *        the Knex connection.
    * @return {Promise}
    */
   migrateCreate(req /*, knex */) {
      var error = new Error(
         `!!! Field [${this.fieldKey()}] has not implemented migrateCreate()!!! `
      );
      req.logError(error);
      return Promise.reject(error);
   }

   /**
    * @function migrateUpdate
    * perform the necessary sql actions to MODIFY this column to the DB table.
    * @param {ABUtil.reqService} req
    *        the request object for the job driving the migrateUpdate().
    * @param {knex} knex
    *        the Knex connection.
    * @return {Promise}
    */
   migrateUpdate(req /* , knex */) {
      var error = new Error(
         `!!! Field [${this.fieldKey()}] has not implemented migrateUpdate()!!! `
      );
      req.logError(error);

      return new Promise((resolve, reject) => {
         // skip to MODIFY exists column
         resolve();
      });
   }

   /**
    * @function migrateDrop
    * perform the necessary sql actions to drop this column from the DB table.
    * @param {ABUtil.reqService} req
    *        the request object for the job driving the migrateDrop().
    * @param {knex} knex
    *        the Knex connection.
    * @return {Promise}
    */
   migrateDrop(req, knex) {
      knex = knex || this.AB.Knex.connection(this.object.connName);

      // if column name is empty, then .hasColumn function always returns true
      if (
         this.columnName == "" ||
         // if field is imported, then it will not remove column in table
         this.object.isImported ||
         this.object.isExternal ||
         this.isImported
      )
         return Promise.resolve();

      let tableName = this.object.dbTableName();

      return (
         Promise.resolve()

            // if the table exists:
            .then(() => {
               return new Promise((next, err) => {
                  knex.schema.hasTable(tableName).then((exists) => {
                     next(exists);
                  });
               });
            })

            // check column exists
            .then((isTableExists) => {
               if (!isTableExists) return Promise.resolve();

               return new Promise((next, err) => {
                  // get the .table editor and drop the column
                  knex.schema
                     .table(tableName, (t) => {
                        knex.schema
                           .hasColumn(tableName, this.columnName)
                           .then((exists) => {
                              next(exists);
                           })
                           .catch(err);
                     })
                     .catch(err);
               });
            })

            // drop foreign key of the column (if exists)
            .then(
               (isColumnExists) =>
                  new Promise((next, err) => {
                     if (!isColumnExists) return next();

                     knex.schema
                        .table(tableName, (t) => {
                           t.dropForeign(this.columnName);
                        })
                        .then(() => next(isColumnExists))
                        .catch((error) => next(isColumnExists));
                  })
            )

            // drop the column
            .then(
               (isColumnExists) =>
                  new Promise((next, err) => {
                     if (!isColumnExists) return next();

                     knex.schema
                        .table(tableName, (t) => {
                           t.dropColumn(this.columnName);
                        })
                        .then(next)
                        .catch((error) => {
                           if (
                              error.code == "ER_CANT_DROP_FIELD_OR_KEY" ||
                              error.code == "ER_DROP_INDEX_FK"
                           ) {
                              next();
                           } else {
                              err(error);
                           }
                        });
                  })
            )

            // Update queries who include the removed column
            .then(() => {
               return new Promise((next, err) => {
                  let tasks = [];

                  let queries = this.AB.queries(
                     (obj) =>
                        obj && obj.canFilterField && obj.canFilterField(this)
                  );
                  (queries || []).forEach((q) => {
                     // Remove the field from query
                     q._fields = q.fields((f) => {
                        return f && f.field && f.field.id != this.id;
                     });

                     // Update MySql view of the query
                     tasks.push(q.migrateCreate(req));
                  });

                  Promise.all(tasks)
                     .then(() => next())
                     .catch(() => next()); // ignore error of queries
               });
            })

            // have the Model refresh it's objection/knex definitions:
            .then(() => {
               this.object.model().modelKnexRefresh();
            })
      );
   }

   ///
   /// DB Model Services
   ///

   /**
    * @method jsonSchemaProperties
    * register your current field's properties here:
    */
   jsonSchemaProperties(obj) {
      sails.log.error(
         "!!! Field [" +
            this.fieldKey() +
            "] has not implemented jsonSchemaProperties()!!! "
      );
   }

   /**
    * @method requestParam
    * return the entry in the given input that relates to this field.
    * @param {obj} allParameters  a key=>value hash of the inputs to parse.
    * @return {obj} or undefined
    */
   requestParam(allParameters) {
      var myParameter;

      if (!_.isUndefined(allParameters[this.columnName])) {
         myParameter = {};
         myParameter[this.columnName] = allParameters[this.columnName];
      }

      return myParameter;
   }

   requestRelationParam(allParameters) {
      var myParameter;

      if (
         !_.isUndefined(allParameters[this.columnName]) &&
         (this.key == "connectObject" || this.key == "user")
      ) {
         myParameter = {};
         myParameter[this.columnName] = allParameters[this.columnName];
      }

      return myParameter;
   }

   /**
    * @method isValidData
    * Parse through the given parameters and return an error if this field's
    * data seems invalid.
    * @param {obj} allParameters  a key=>value hash of the inputs to parse.
    * @return {array}
    */
   isValidData(allParameters) {
      var errors = [];
      sails.log.error(
         "!!! Field [" +
            this.fieldKey() +
            "] has not implemented .isValidData()!!!"
      );
      return errors;
   }

   /**
    * @method postGet
    * Perform any final conditioning of data returned from our DB table before
    * it is returned to the client.
    * @param {obj} data  a json object representing the current table row
    */
   postGet(data) {
      return new Promise((resolve, reject) => {
         resolve();
      });
   }

   /**
    * Generate the SQL for the key portion of our filter condition. Can be
    * overwritten for non standard field types (Calculate, Formula, etc)
    * @method conditionKey
    */
   conditionKey() {
      return `${this.dbPrefix()}.\`${this.columnName}\``;
   }
};
