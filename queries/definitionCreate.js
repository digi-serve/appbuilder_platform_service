/**
 * definitionCreate.js
 * insert a value into the appbuilder_definition table.
 * @param {ABUtil.request} req
 *        a tenant aware request object used to assist in building the
 *        sql data.
 * @param {obj} values
 *        a value hash representing the data for the operation.
 * @return {Promise}
 *        resolve(): full {value} of the newly created entry
 */
const uuidv4 = require("uuid");
const queryDefinitionFind = require("./definitionFind");

module.exports = function (req, values) {
   return new Promise((resolve, reject) => {
      let tenantDB = req.queryTenantDB(reject);
      if (!tenantDB) {
         // reject() has already been called in .queryTenantDB()
         return;
      }

      tenantDB += ".";

      let sqlInsert = `INSERT INTO ${tenantDB}\`appbuilder_definition\` SET ?`;

      // prepare values
      var now = new Date();
      let usefulValues = {
         id: values.id || uuidv4(),
         createdAt: now,
         updatedAt: now,
      };

      Object.keys(values).forEach((k) => {
         usefulValues[k] = values[k];
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
            req.log(sqlInsert);
            reject(error);
         } else {
            // We want to return a fully populated entry back:
            let cond = { id: usefulValues.id };
            queryDefinitionFind(req, cond)
               .then((rows) => {
                  resolve(rows[0]);
               })
               .catch(reject);
         }
      });
   });
};
