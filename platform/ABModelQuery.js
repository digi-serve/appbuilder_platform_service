const ABModel = require("./ABModel");

module.exports = class ABModelQuery extends ABModel {
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
   create(values, trx = null, condDefaults = null, req = null) {
      var error = new Error(
         "ABObjectQuery.ABModelQuery.create() should not be called."
      );
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
   findAll(options = {}, userData, req) {
      let raw = this.AB.Knex.connection().raw,
         query = this.AB.Knex.connection().queryBuilder();
      query.from(this.dbViewName());

      return (
         Promise.resolve()

            // Filter condition
            .then(() => {
               return new Promise((next, bad) => {
                  if (!options.ignoreIncludeId) {
                     // SELECT Running Number to be .id as a subquery
                     // SQL: select @rownum:=@rownum+1 as `id`, result.*
                     //    from (
                     //       select distinct ...
                     //       ) result , (SELECT @rownum:=0) r;
                     let queryRoot = this.AB.Knex.connection().queryBuilder(),
                        queryString = query.toString();

                     query = queryRoot
                        .select(raw("@rownum := @rownum + 1 AS id, result.*"))
                        .from(function () {
                           let sqlCommand = raw(
                              queryString.replace("select ", "")
                           );

                           // sub query: NOTE: "this" == query
                           this.select(sqlCommand).as("result");
                        })
                        .join(
                           raw(
                              `(SELECT @rownum := ${
                                 options.offset || 0
                              }) rownum`
                           )
                        )
                        .as("rId");
                  }

                  // update our condition to include the one we are defined with:
                  //
                  let where = this.where;
                  if (where && where.glue && !options.skipExistingConditions) {
                     // we need to make sure our options.where properly contains our
                     // internal definitions as well.

                     // case: we have a valid passed in options.where
                     var haveOptions =
                        options.where &&
                        options.where.rules &&
                        options.where.rules.length > 0;

                     // case: we have a valid internal definition:
                     var haveInternal =
                        where && where.rules && where.rules.length > 0;

                     // if BOTH cases are true, then we need to AND them together:
                     if (haveOptions && haveInternal) {
                        // if (options.where && options.where.glue && options.where.rules && options.where.rules.length > 0) {

                        // in the case where we have a condition and a condition was passed in
                        // combine our conditions
                        // queryCondition AND givenConditions:
                        var oWhere = this.AB.cloneDeep(options.where);
                        var thisWhere = this.AB.cloneDeep(where);

                        var newWhere = {
                           glue: "and",
                           rules: [thisWhere, oWhere],
                        };

                        options.where = newWhere;
                     } else {
                        if (haveInternal) {
                           // if we had a condition and no condition was passed in,
                           // just use ours:
                           options.where = this.AB.cloneDeep(where);
                        }
                     }
                  }

                  if (options) {
                     this.reduceConditions(options.where, userData)
                        .then(() => {
                           // when finished populate our Find Conditions
                           this.queryConditions(query, options.where, userData);
                           next();
                        })
                        .catch(bad);
                  }
               });
            })

            // Select columns
            .then(() => {
               if (options.ignoreIncludeColumns) {
                  // get count of rows does not need to include columns
                  query.clearSelect();
               }

               if (options.columnNames && options.columnNames.length) {
                  // MySQL view: remove ` in column name
                  options.columnNames = options.columnNames.map((colName) => {
                     if (typeof colName == "string") {
                        colName = "`" + (colName || "").replace(/`/g, "") + "`";
                        colName = this.AB.Knex.connection().raw(colName);
                     }

                     return colName;
                  });

                  query.clearSelect().select(options.columnNames);
               }

               // edit property names of .translation
               // {objectName}.{columnName}
               if (!options.ignoreEditTranslations) {
                  query.on("query-response", function (rows, obj, builder) {
                     (rows || []).forEach((r) => {
                        // each rows
                        Object.keys(r).forEach((rKey) => {
                           // objectName.translations
                           if (rKey.endsWith(".translations")) {
                              r.translations = r.translations || [];

                              let objectName = rKey.replace(
                                 ".translations",
                                 ""
                              );

                              let translations = [];
                              if (typeof r[rKey] == "string")
                                 translations = JSON.parse(r[rKey]);

                              // each elements of trans
                              (translations || []).forEach((tran) => {
                                 let addNew = false;

                                 let newTran = r.translations.filter(
                                    (t) => t.language_code == tran.language_code
                                 )[0];
                                 if (!newTran) {
                                    newTran = {
                                       language_code: tran.language_code,
                                    };
                                    addNew = true;
                                 }

                                 // include objectName into property - objectName.propertyName
                                 Object.keys(tran).forEach((tranKey) => {
                                    if (tranKey == "language_code") return;

                                    var newTranKey = "{objectName}.{propertyName}"
                                       .replace("{objectName}", objectName)
                                       .replace("{propertyName}", tranKey);

                                    // add new property name
                                    newTran[newTranKey] = tran[tranKey];
                                 });

                                 if (addNew) r.translations.push(newTran);
                              });

                              // remove old translations
                              delete rows[rKey];
                           }
                        });
                     });
                  });
               } // if ignoreEditTranslations

               return Promise.resolve();
            })

            // Final
            .then(() => {
               if (req) {
                  req.log("ABModelQuery.findAll():", query.toString());
               }
               return Promise.resolve(query);
            })
      );
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
      // options = options || {};

      // we don't include relative data on counts:
      // and get rid of any .sort, .offset, .limit
      // options.includeRelativeData = false;
      delete options.sort;
      delete options.offset;
      delete options.limit;

      // not update translations key names
      options.ignoreEditTranslations = true;

      // not include .id column
      options.ignoreIncludeId = true;

      // not include columns
      // to prevent 'ER_MIX_OF_GROUP_FUNC_AND_FIELDS' error
      options.ignoreIncludeColumns = true;

      // return the count not the full data
      options.columnNames = [
         this.AB.Knex.connection().raw("COUNT(*) as count"),
      ];

      // added tableName to id because of non unique field error
      return this.findAll(options, userData, req).then((result) => {
         return result[0];
         // return result[0]['count'];
      });
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
   update(id, values, trx = null) {
      var error = new Error(
         "ABObjectQuery.ABModelQuery.update() should not be called."
      );
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
   relate(id, fieldRef, value, trx = null) {
      var error = new Error(
         "ABObjectQuery.ABModelQuery.relate() should not be called."
      );
      return Promise.reject(error);
   }
};
