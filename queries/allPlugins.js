/**
 * allPlugins.js
 * returns all the Plugin definitions in our SITE_PLUGIN table that
 * match the given platform.
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

module.exports = function (req, cond, options = {}) {
   return new Promise((resolve, reject) => {
      let tenantDB = req.queryTenantDB(reject);
      if (!tenantDB) {
         // reject() has already been called in .queryTenantDB()
         return;
      }

      tenantDB += ".";

      let sql = `SELECT * FROM ${tenantDB}\`AB_SITE_OBJECTS_SITE_PLUGINS\``;

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
