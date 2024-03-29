/*
 * ABFieldCalculate
 *
 * An ABFieldCalculate defines a Date field type.
 *
 */
const path = require("path");
// prettier-ignore
const ABFieldCalculateCore = require(path.join(__dirname, "..", "..", "core", "dataFields", "ABFieldCalculateCore.js"));

module.exports = class ABFieldCalculate extends ABFieldCalculateCore {
   constructor(values, object) {
      super(values, object);
   }

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
      var errors = [];

      return errors;
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
    * Generate the SQL for the key portion of our filter condition. We need run
    * the calculate formula from SQL.
    * @method conditionKey
    */
   conditionKey(userData, req) {
      let formula = this.settings.formula.replace(/{[^}]+}/g, (match) => {
         // replace spaces within column names to make parseing the formula easier
         return match.replaceAll(" ", "__");
      });
      const { result: formulaParts } = this.parseFormula(formula);
      const invalidParts = [];

      const convertSQL = (parts) => {
         let sqlFormula = "";
         for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (part instanceof Array) {
               sqlFormula += `(${convertSQL(part)})`;
            } else {
               switch (part) {
                  // I don't think these are worth implementing in SQL. We
                  // can add if there is a real usecase.
                  case "DATE":
                  case "HOUR":
                  case "MINUTE":
                  case "MINUTE_TO_HOUR":
                     invalidParts.push(`${part}(${parts[i + 1].join("")})`);
                     sqlFormula += "0";
                     i++; // skip the next part
                     break;
                  case "AGE":
                     sqlFormula = "YEAR(NOW()) - YEAR";
                     break;
                  case "CURRENT":
                     sqlFormula = "NOW()";
                     break;
                  // DAY() and YEAR() should work by default in SQL, MONTH() will start from
                  // 1 so we need to subtract 1 to match our js implementation
                  case "MONTH":
                     sqlFormula = `(MONTH(${convertSQL(parts[i + 1])}) - 1)`;
                     i++; //Next part already handled
                     break;
                  default:
                     sqlFormula += part;
               }
            }
         }
         return sqlFormula;
      };

      formula = convertSQL(formulaParts);
      if (invalidParts.length > 0) {
         req.notify.builder(
            `ABFieldCalculate.conditionKey(): Unsupported methods in calucate field ${this.name}. Filter will not work correctly.`,
            { calculateField: this, invalidParts }
         );
      }
      // replace `{columnName}` with the field.conditionKey()
      formula = formula.replace(/{([^}]+)}/g, (match, column) => {
         column = column.replaceAll("__", " ");
         const formulaField =
            this.object.fields((f) => f.columnName == column)[0] ?? {};

         switch (formulaField.key) {
            case "number":
               return `COALESCE(${formulaField.conditionKey()}, 0)`;
            // We use COALESCE so that null will be interpreted as 0
            case "calculate":
            case "date":
            case "datetime":
            case "formula":
               return formulaField.conditionKey(userData, req);
            default:
               req.notify.builder(
                  `ABFieldCalculate.conditionKey(): Unexpected field "${formulaField.name}" in calucate field ${this.name} formula`,
                  { calculateField: this, formulaField }
               );
               return 0;
         }
      });

      return formula;
   }

   /**
    * Recursively parse the formula into it's part, preserving nested brackets
    * @function parseFormula
    * @param {string|string[]} input a formula string or array of characters in the formula
    * @param {int=0} i index for recursion
    * @return {array} format A + B(C+D) => ['A','+', 'B', ['C', '+', 'D' ]]
    */
   parseFormula(input, i = 0) {
      const characters = typeof input == "string" ? input.split("") : input;
      const result = [];
      let resultIndex = 0;
      for (i; i < characters.length; i++) {
         const character = characters[i];
         let response;
         switch (character) {
            case "(":
               response = this.parseFormula(characters, i + 1);
               if (result[resultIndex]) resultIndex++;
               result[resultIndex] = response.result;
               resultIndex++;
               i = response.i;
               break;
            case ")":
               return { result, i: i };
            case "-":
            case "+":
            case "*":
            case "/":
               if (result[resultIndex]) resultIndex++;
               result[resultIndex] = character;
               resultIndex++;
               break;
            case " ":
               if (result[resultIndex]) resultIndex++;
               break;
            default:
               result[resultIndex] = result[resultIndex] ?? "";
               result[resultIndex] += character;
         }
      }
      return { result, i };
   }
};
