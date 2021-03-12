/**
 * definitionFind.js
 * returns all the {ABDefinition} rows in the appbuilder_definition that
 * match a given {cond}
 * @param {ABUtil.request} req
 *        a tenant aware request object used to assist in building the
 *        sql data.
 * @param {obj} cond
 *        a value hash representing the condition for the operation.
 * @return {Promise}
 *        resolve(): {array} [{value}, {value}...]
 */

module.exports = function (req, cond) {
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
            req.log(sql);
            reject(error);
         } else {
            resolve(results);
         }
      });
   });
};
