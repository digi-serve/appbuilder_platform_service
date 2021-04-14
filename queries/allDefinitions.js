/**
 * allDefinitions.js
 * returns all the {ABDefinition} rows in the appbuilder_definition
 * table
 * @param {ABUtil.request} req
 *        a tenant aware request object used to assist in building the
 *        sql data.
 * @return {Promise}
 *        resolve(): {array} [{value}, {value}...]
 */

const queryDefinitionFind = require("./definitionFind");

module.exports = function (req) {
   return queryDefinitionFind(null, req, null);
   // sending null for the condition results in getting all the entries.
};
