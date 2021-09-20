/**
 * definitionUpdate.js
 * modify a current definition
 * @param {ABFactory} AB
 *        The ABFactory that manages the Tenant Data this request should
 *        operate under.
 * @param {ABUtils.reqService} req
 *        The service request object that is driving this operation.
 * @param {obj} cond
 *        a value hash representing the condition for the operation.
 * @param {obj} data
 *        a value hash representing the data for the operation.
 * @return {Promise}
 *        resolve(): full {value} of the newly updated entry
 */
const queryDefinitionFind = require("./definitionFind");
module.exports = function (AB, req, cond, data, options = {}) {
   return new Promise((resolve, reject) => {
      let tenantDB = req.queryTenantDB(reject);
      if (!tenantDB) {
         // reject() has already been called in .queryTenantDB()
         return;
      }

      tenantDB += ".";

      if (!data.updatedAt) {
         data.updatedAt = AB.rules.toSQLDateTime(new Date());
      }

      var dateKeys = ["updatedAt", "createdAt"];
      dateKeys.forEach((k) => {
         if (data[k]) {
            data[k] = AB.rules.toSQLDateTime(data[k]);
         }
      });

      // make sure we store our .json as a string:
      if (data.json && !data.json.charAt) {
         try {
            data.json = JSON.stringify(data.json);
         } catch (e) {
            req.log(e);
         }
      }

      var sql = `UPDATE ${tenantDB}\`appbuilder_definition\` SET ? `;

      let { condition, values } = req.queryWhereCondition(cond);
      if (condition) {
         sql += `WHERE ${condition}`;
      }

      // put the values to SET as the 1st item in the array:
      values = values || [];
      values.unshift(data);

      req.query(sql, values, (error, results /* , fields */) => {
         if (error) {
            if (
               !options.silenceErrors ||
               options.silenceErrors.indexOf(error.code) == -1
            ) {
               req.log(error);
            }
            reject(error);
         } else {
            req.log.verbose("definitionUpdate.query() results:", results);

            queryDefinitionFind(AB, req, cond)
               .then((rowsUpdated) => {
                  resolve(rowsUpdated);
               })
               .catch(reject);
         }
      });
   });
};
