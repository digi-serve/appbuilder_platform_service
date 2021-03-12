/**
 * definitionDestroy.js
 * delete the {ABDefinition} row in the appbuilder_definition
 * table that matches the given {cond}
 * @param {ABUtil.request} req
 *        a tenant aware request object used to assist in building the
 *        sql data.
 * @param {obj} cond
 *        a value hash representing the condition for the operation.
 * @return {Promise}
 *       resolve() with no value returned.
 */

module.exports = function (req, cond) {
   return new Promise((resolve, reject) => {
      let tenantDB = req.queryTenantDB(reject);
      if (!tenantDB) {
         // reject() has already been called in .queryTenantDB()
         return;
      }

      tenantDB += ".";

      let sql = `DELETE FROM ${tenantDB}\`appbuilder_definition\``;

      let { condition, values } = req.queryWhereCondition(cond);
      if (condition) {
         sql += `WHERE ${condition}`;
      }

      req.query(sql, values, (error, results /* , fields */) => {
         if (error) {
            req.log(sql);
            reject(error);
         } else {
            console.log("definitionDestroy.query() results:", results);
            // empty resolve.
            resolve();
         }
      });
   });
};
