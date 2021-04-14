/**
 * definitionCreate.js
 * insert a value into the appbuilder_definition table.
 * @param {ABFactory} AB
 *        The ABFactory that manages the Tenant Data this request should
 *        operate under.
 * @param {ABUtils.reqService} req
 *        The service request object that is driving this operation.
 * @param {obj} values
 *        a value hash representing the data for the operation.
 * @return {Promise}
 *        resolve(): full {value} of the newly created entry
 */
const uuidv4 = require("uuid");
const queryDefinitionFind = require("./definitionFind");

module.exports = function (AB, req, values, options = {}) {
   return new Promise((resolve, reject) => {
      let tenantDB = req.queryTenantDB(reject);
      if (!tenantDB) {
         // reject() has already been called in .queryTenantDB()
         return;
      }

      tenantDB += ".";

      let sqlInsert = `INSERT INTO ${tenantDB}\`appbuilder_definition\` SET ?`;

      // prepare values
      var now = AB.rules.toSQLDateTime(new Date());
      let usefulValues = {
         id: values.id || uuidv4(),
         createdAt: now,
         updatedAt: now,
      };

      var dateKeys = ["updatedAt", "createdAt"];
      Object.keys(values).forEach((k) => {
         if (dateKeys.indexOf(k) == -1) {
            usefulValues[k] = values[k];
         } else {
            if (values[k]) {
               usefulValues[k] = AB.rules.toSQLDateTime(values[k]);
            }
         }
      });

      // make sure we store our .json as a string:
      if (usefulValues.json && !usefulValues.json.charAt) {
         try {
            usefulValues.json = JSON.stringify(usefulValues.json);
         } catch (e) {
            req.log(e);
         }
      }

      req.query(sqlInsert, usefulValues, (error /* results, fields */) => {
         if (error) {
            if (
               !options.silenceErrors ||
               options.silenceErrors.indexOf(error.code) == -1
            ) {
               req.log(error);
            }
            reject(error);
         } else {
            // We want to return a fully populated entry back:
            let cond = { id: usefulValues.id };
            queryDefinitionFind(AB, req, cond)
               .then((rows) => {
                  resolve(rows[0]);
               })
               .catch(reject);
         }
      });
   });
};
