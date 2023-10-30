//
// ABModelAPI
//
// Represents the Data interface for an ABObjectQuery data.

const ABModelCore = require("../core/ABModelCore.js");

module.exports = class ABModelAPI extends ABModelCore {
   ///
   /// Instance Methods
   ///

   /**
    * @method findAll
    * performs a data find with the provided condition.
    * @param {obj} cond
    *    A set of optional conditions to add to the find():
    * @param {obj} conditionDefaults
    *    A hash of default condition values.
    *    conditionDefaults.languageCode {string} the default language of
    *       the multilingual data to return.
    *    conditionDefaults.username {string} the username of the user
    *       we should reference on any user based condition
    * @param {ABUtil.reqService} req
    *    The request object associated with the current tenant/request
    * @return {Promise} resolved with the result of the find()
    */
   async findAll(cond, conditionDefaults, req) {
      const requestConfigs = this.object.request ?? {};
      let url = requestConfigs.url;
      let headers = this.object.headers;

      // Paging
      const pagingValues = this.object.getPagingValues({
         skip: cond?.skip,
         limit: cond?.limit,
      });
      if (Object.keys(pagingValues).length) {
         switch (requestConfigs.paging.type) {
            case "queryString":
               url = `${url}?${new URLSearchParams(pagingValues).toString()}`;
               break;
            case "header":
               headers = Object.assign(headers, pagingValues);
               break;
         }
      }

      // Load data
      const response = await fetch(url, {
         method: (requestConfigs.verb ?? "GET").toUpperCase(),
         headers,
         mode: "cors",
         cache: "no-cache",
      });

      // Convert to JSON
      let result = await response.json();

      // Extract data from key
      result = this.object.dataFromKey(result);

      // Convert to an Array
      if (result && !Array.isArray(result)) result = [result];

      return result;
   }

   /**
    * @method findCount
    * performs a data find to get the total Count of a given condition.
    * @param {obj} cond
    *    A set of optional conditions to add to the find():
    * @param {obj} conditionDefaults
    *    A hash of default condition values.
    *    conditionDefaults.languageCode {string} the default language of
    *       the multilingual data to return.
    *    conditionDefaults.username {string} the username of the user
    *       we should reference on any user based condition
    * @param {ABUtil.reqService} req
    *    The request object associated with the current tenant/request
    * @return {Promise} resolved with the result of the find()
    */
   async findCount(cond, conditionDefaults, req) {
      const returnData = await this.findAll(cond, conditionDefaults, req);

      // // Paging
      // const pagingValues = this.object.getPagingValues({
      //    skip: cond?.skip,
      //    limit: cond?.limit,
      // });
      // pagingValues.total

      return returnData?.length;
   }
};

