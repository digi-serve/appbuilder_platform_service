const ABModel = require("./ABModel");

module.exports = class ABModelApi extends ABModel {
   /**
    * @method create
    * performs an update operation
    * @param {obj} values
    *    A hash of the new values for this entry.
    * @param {Knex.Transaction?} trx - [optional]
    * @param {ABUtil.reqApi} req
    *    The request object associated with the current tenant/request
    * @return {Promise} resolved with the result of the find()
    */
   create(/* values, trx = null, condDefaults = null, req = null */) {
      const error = new Error("ABModelApi.create() should not be called.");
      return Promise.reject(error);
   }

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
    * @return {Promise} resolved with the result of the find()
    */
   async findAll(options = {}, userData, req) {
      const error = new Error("ABModelApi.findAll() should not be called.");
      return Promise.reject(error);
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
    * @return {Promise} resolved with the result of the find()
    */
   findCount(options, userData, req) {
      const error = new Error("ABModelApi.findCount() should not be called.");
      return Promise.reject(error);
   }

   /**
    * @method update
    * performs an update operation
    * @param {string} id
    *		the primary key for this update operation.
    * @param {obj} values
    *		A hash of the new values for this entry.
    * @param {Knex.Transaction?} trx - [optional]
    *
    * @return {Promise} resolved with the result of the find()
    */
   update(/* id, values, trx = null */) {
      const error = new Error("ABModelApi.update() should not be called.");
      return Promise.reject(error);
   }

   /**
    * @method relate()
    * connect an object to another object via it's defined relation.
    *
    * this operation is ADDITIVE. It only appends additional relations.
    *
    * @param {string} id
    *       the uuid of this object that is relating to these values
    * @param {string} field
    *       a reference to the object.fields() that we are connecting to
    *       can be either .uuid or .columnName
    * @param {array} values
    *       one or more values to create a connection to.
    *       these can be either .uuid values, or full {obj} values.
    * @param {Knex.Transaction?} trx - [optional]
    *
    * @return {Promise}
    */
   relate(/* id, fieldRef, value, trx = null */) {
      const error = new Error("ABModelApi.relate() should not be called.");
      return Promise.reject(error);
   }
};
