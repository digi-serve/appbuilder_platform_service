var path = require("path");
var _ = require("lodash");

var ABObject = require(path.join(__dirname, "ABObject"));

var Model = require("objection").Model;

function getColumnFn(colType) {
   var result = colType;

   switch (colType) {
      case "bit":
      case "int":
      case "integer":
      case "tinyint":
         result = "integer";
         break;
      case "bigint":
      case "decimal":
      case "dec":
      case "float":
      case "double":
      case "double_precision":
         result = "bigInteger";
         break;
      case "blob":
      case "tinyblob":
      case "mediumblob":
      case "longblob":
         result = "binary";
         break;
      case "char":
      case "tinytext":
      case "varchar":
         result = "string";
         break;
      case "mediumtext":
      case "longtext":
         result = "text";
         break;
   }

   return result;
}

// to minimize .knex bindings (and connection pools!)

module.exports = class ABObjectExternal extends ABObject {
   // constructor(attributes, AB) {
   //    super(attributes, AB);
   // }

   dbTransTableName(prefixSchema = false) {
      return `${this.dbTableName(prefixSchema)}_trans`;
   }

   /**
    * migrateCreateTable
    * verify that a table for this object exists.
    * @param {Knex} knex
    *        the knex sql library manager for manipulating the DB.
    * @param {Object} options
    *        table connection info -
    * 				{
    * 					connection: "",
    * 					table: "",
    * 					primary: "Primary column name"
    * 				}
    * @return {Promise}
    */
   migrateCreate(knex, options) {
      console.log("ABObjectExternal.migrateCreate()");
      // We no longer create Federated Tables.
      // Now we simply accept connections to outside Tables and work with them.
      return Promise.resolve();
   }

   /**
    * migrateDropTable
    * remove the table for this object if it exists.
    * @param {Knex} knex
    *        the knex sql library manager for manipulating the DB.
    * @return {Promise}
    */
   migrateDrop(knex) {
      console.log("ABObject.migrateDrop()");

      // We no longer manage Federated Tables, so we don't drop our
      // connected table.
      return Promise.resolve();
   }

   ///
   /// DB Model Services
   ///

   modelRelation() {
      var relationMappings = super.modelRelation();
      var tableTransName = this.dbTransTableName(true);

      // Add a translation relation of the external table
      if (this.transColumnName) {
         var transJsonSchema = {
            language_code: { type: "string" },
         };

         // Populate fields of the trans table
         var multilingualFields = this.fields(
            (f) => f.settings.supportMultilingual == 1
         );
         multilingualFields.forEach((f) => {
            f.jsonSchemaProperties(transJsonSchema);
         });

         class TransModel extends Model {
            // Table name is the only required property.
            static get tableName() {
               return tableTransName;
            }

            static get jsonSchema() {
               return {
                  type: "object",
                  properties: transJsonSchema,
               };
            }
         }

         relationMappings["translations"] = {
            relation: Model.HasManyRelation,
            modelClass: TransModel,
            join: {
               from: "{targetTable}.{primaryField}"
                  .replace("{targetTable}", this.dbTableName(true))
                  .replace("{primaryField}", this.PK()),
               to: "{sourceTable}.{field}"
                  .replace("{sourceTable}", TransModel.tableName)
                  .replace("{field}", this.transColumnName),
            },
         };
      }

      return relationMappings;
   }

   /**
    * @method requestParams
    * Parse through the given parameters and return a subset of data that
    * relates to the fields in this object.
    * @param {obj} allParameters
    *        a key=>value hash of the inputs to parse.
    * @return {obj}
    */
   requestParams(allParameters) {
      var usefulParameters = super.requestParams(allParameters);

      // WORKAROUND : HRIS tables does not support non null columns
      Object.keys(usefulParameters).forEach((columnName) => {
         if (
            usefulParameters[columnName] == null ||
            (Array.isArray(usefulParameters[columnName]) &&
               !usefulParameters[columnName].length)
         ) {
            delete usefulParameters[columnName];
         }
      });

      return usefulParameters;
   }

   requestRelationParams(allParameters) {
      var usefulParameters = super.requestRelationParams(allParameters);

      // WORKAROUND : HRIS tables does not support non null columns
      Object.keys(usefulParameters).forEach((columnName) => {
         if (
            usefulParameters[columnName] == null ||
            (Array.isArray(usefulParameters[columnName]) &&
               !usefulParameters[columnName].length)
         ) {
            delete usefulParameters[columnName];
         }
      });

      return usefulParameters;
   }
};
