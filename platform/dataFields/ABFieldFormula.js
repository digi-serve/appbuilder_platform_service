/*
 * ABFieldBoolean
 *
 * An ABFieldBoolean defines a Date field type.
 *
 */
const path = require("path");
// prettier-ignore
const ABFieldFormulaCore = require(path.join(__dirname, "..", "..", "core", "dataFields", "ABFieldFormulaCore.js"));

module.exports = class ABFieldFormula extends ABFieldFormulaCore {
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
   migrateCreate(/* req, knex */) {
      return Promise.resolve();
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
    * @function migrateDrop
    * perform the necessary sql actions to drop this column from the DB table.
    * @param {ABUtil.reqService} req
    *        the request object for the job driving the migrateCreate().
    * @param {knex} knex
    *        the Knex connection.
    * @return {Promise}
    */
   migrateDrop(/* req, knex */) {
      return Promise.resolve();
   }

   /**
    * @method requestParam
    * return the entry in the given input that relates to this field.
    * @param {obj} allParameters  a key=>value hash of the inputs to parse.
    * @return {obj} or undefined
    */
   requestParam(allParameters) {
      let myParameter = super.requestParam(allParameters);
      if (myParameter) {
         delete myParameter[this.columnName];
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

   ///
   /// DB Model Services
   ///

   /**
    * @method jsonSchemaProperties
    * register your current field's properties here:
    */
   jsonSchemaProperties(obj) {
      // take a look here:  http://json-schema.org/example1.html

      // if our field is not already defined:
      if (!obj[this.columnName]) {
         obj[this.columnName] = { type: "null" };
      }
   }

   /**
    * Generate the SQL for the key portion of our filter condition. We need to
    * preform the formula using SQL.
    * @method conditionKey
    */
   conditionKey(userData, req) {
      let operation = this.settings.type.toUpperCase();
      if (operation == "AVERAGE") operation = "AVG";
      // In all other cases the SQL syntax for the operat matches our type

      const connectObject = this.AB.objectByID(this.settings.object);
      const linkColumnId = this.object.fields(
         (f) => f.id == this.settings.field
      )[0].settings.linkColumn;
      const linkColumn = connectObject.fields((f) => f.id == linkColumnId)[0];
      const operationCol = connectObject.fields(
         (f) => f.id == this.settings.fieldLink
      )[0].columnName;
      const connectedWhere = `${linkColumn.conditionKey()} = ${this.dbPrefix()}.uuid`;
      // Filter by connection to this object
      const formulaWhere = this.settings.where;
      let extraWhere = "";
      if (formulaWhere.rules?.length > 0) {
         const connectModel = connectObject.model();
         const parsedRules = [];
         formulaWhere.rules.forEach((rule) => {
            parsedRules.push(connectModel.parseCondition(rule, userData, req));
         });
         extraWhere = ` AND (${parsedRules.join(` ${formulaWhere.glue} `)})`;
      }
      // COALESE here replaces null with 0 (when no connected records found)
      return `COALESCE((SELECT ${operation}(\`${operationCol}\`) FROM ${linkColumn.dbPrefix()} WHERE ${connectedWhere}${extraWhere}), 0)`;
   }
};
