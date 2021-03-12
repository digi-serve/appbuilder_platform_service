/**
 * definitionUpdate.js
 * modify a current definition
 * @param {ABUtil.request} req
 *        a tenant aware request object used to assist in building the
 *        sql data.
 * @param {obj} cond
 *        a value hash representing the condition for the operation.
 * @param {obj} values
 *        a value hash representing the data for the operation.
 * @return {Promise}
 *        resolve(): full {value} of the newly updated entry
 */
const queryDefinitionFind = require("./definitionFind");
module.exports = function (req, cond, values) {
   return new Promise((resolve, reject) => {
      let tenantDB = req.queryTenantDB(reject);
      if (!tenantDB) {
         // reject() has already been called in .queryTenantDB()
         return;
      }

      tenantDB += ".";

      if (!values.updatedAt) {
         values.updatedAt = new Date();
      }

      var sql = `UPDATE ${tenantDB}\`appbuilder_definition\` SET ? `;

      let { condition, placeholders } = req.queryWhereCondition(cond);
      if (condition) {
         sql += `WHERE ${condition}`;
      }

      // put the values to SET as the 1st item in the array:
      placeholders = placeholders || [];
      placeholders.unshift(values);

      req.query(sql, placeholders, (error, results /* , fields */) => {
         if (error) {
            req.log(sql);
            reject(error);
         } else {
            console.log("definitionUpdate.query() results:", results);

            queryDefinitionFind(req, condition)
               .then((rowsUpdated) => {
                  resolve(rowsUpdated);
               })
               .catch(reject);
         }
      });
   });
};
