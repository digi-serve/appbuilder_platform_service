/**
 * definitionFind.js
 * returns all the {ABDefinition} rows in the appbuilder_definition that
 * match a given {cond}
 * @param {ABFactory} AB
 *        The ABFactory that manages the Tenant Data this request should
 *        operate under.
 * @param {ABUtils.reqService} req
 *        The service request object that is driving this operation.
 * @param {obj} cond
 *        a value hash representing the condition for the operation.
 * @return {Promise}
 *        resolve(): {array} [{value}, {value}...]
 */

module.exports = function (AB, req, cond, options = {}) {
   return new Promise((resolve, reject) => {
      let tenantDB = req.queryTenantDB(reject);
      if (!tenantDB) {
         // reject() has already been called in .queryTenantDB()
         return;
      }

      tenantDB += ".";

      let sql = `SELECT * FROM ${tenantDB}\`appbuilder_definition\``;

      let { condition, values } = req.queryWhereCondition(cond);
      if (condition) {
         sql += `WHERE ${condition}`;
      }

      req.query(sql, values, (error, results /*, fields */) => {
         if (error) {
            if (
               !options.silenceErrors ||
               options.silenceErrors.indexOf(error.code) == -1
            ) {
               req.log(error);
            }
            reject(error);
         } else {
            resolve(results);
         }
      });
   });
};
