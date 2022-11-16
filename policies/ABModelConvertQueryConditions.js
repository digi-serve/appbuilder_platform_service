/**
 * ABModelConvertQueryConditions
 *
 * @module      :: Policy
 * @description :: Scan any provided conditions to see if we have a 'in_query'
 *                 or 'not_in_query' clause.  If we do, convert it to an IN or NOT IN
 *                 clause. The assumption is that the current object is in this query.
 * @docs        :: http://sailsjs.org/#!documentation/policies
 *
 */

/**
 * ABModelConvertQueryConditions()
 * Reduce any given "IN QUERY" or "NOT IN QUERY" rules to values that match the
 * current USER and state of the Data.
 * @param {ABFactory} AB
 *       the tenant based ABFactory for this Request
 * @param {obj} where
 *       the QB condition object being evaluated
 * @param {ABObject|ABObjectQuery} object
 *       the ABObjectXXX object evaluating the query conditions.
 * @param {obj} userData
 *       Any specific information relate to the user making this request.
 * @param {fn} next
 *       The node style callback(err, data) for this process.
 */
module.exports = function (AB, where, object, userData, next, req) {
   // our QB Conditions look like:
   // {
   //   "glue": "and",
   //   "rules": [{
   //     "key": "name_first",
   //     "rule": "begins_with",
   //     "value": "a"
   //   }, {
   //     "key": "name_family",
   //     "rule": "begins_with",
   //     "value": "a"
   //   }, {
   //     "glue": "or",
   //     "rules": [{
   //       "glue": "and",
   //       "rules": [{
   //         "key": "name_first",
   //         "rule": "not_begins_with",
   //         "value": "Apple"
   //       }, {
   //         "key": "name_family",
   //         "rule": "not_contains",
   //         "value": "Pie"
   //       }]
   //     }, {
   //       "glue": "and",
   //       "rules": [{
   //         "key": "name_first",
   //         "rule": "ends_with",
   //         "value": "Crumble"
   //       }, {
   //         "key": "name_family",
   //         "rule": "equal",
   //         "value": "Goodness"
   //       }]
   //     }]
   //   }]
   // }
   //
   //

   // move along if no or empty where clause
   if (AB.isEmpty(where)) {
      next();
      return;
   }

   parseQueryCondition(
      AB,
      where,
      object,
      userData,
      (err) => {
         next(err);
      },
      req
   );
};

/**
 * processQueryValues()
 * this step runs the specified Query and pulls out an array of
 * ids that can be used for filtering.
 * This code is brought out so we can Retry the query in the case of
 * a Timeout Error.  This routine will perform a given # of retries before
 * passing an error on.
 * @param {ABFactory} AB
 *       the tenant based ABFactory for this Request
 * @param {obj} userData
 *       Any specific information relate to the user making this request.
 * @param {ABObject|ABObjectQuery} QueryObj
 *       The ABObjectXXX instance that should be running this query.
 * @param {string} queryColumn
 *       [table].[column] format of the data to pull from Query
 * @param {fn} done
 *       a callback routine  done(err, data);
 */
function processQueryValues(AB, userData, QueryObj, queryColumn, done, req) {
   req.retry(() =>
      QueryObj.model().findAll(
         {
            columnNames: [queryColumn],
            ignoreIncludeId: true, // we want real id
         },
         userData,
         req
      )
   )
      .then((data) => {
         // sails.log.info(".... query data : ", data);
         var ids = data
            .map((d) => {
               return d[queryColumn];
            })
            .filter((d) => d != null);
         ids = AB.uniq(ids);

         done(null, ids);
      })
      .catch((err) => {
         var error = AB.toError("Error running query:", {
            location: "ABModelConvertQueryConditions",
            sql: err._sql || "-- unknown --",
            error: err,
         });

         done(error);
      });
}

/**
 * continueSingle()
 * run the expected Query and reformat the condition entry.
 */
function continueSingle(
   AB,
   where,
   object,
   userData,
   cb,
   QueryObj,
   cond,
   newKey,
   queryColumn,
   linkCase,
   req
) {
   // let the processQueryValues() perform any retris then format the result
   processQueryValues(
      AB,
      userData,
      QueryObj,
      queryColumn,
      (err, ids) => {
         if (err) {
            cb(err);
         } else {
            // convert cond into an IN or NOT IN
            cond.key = newKey;
            var convert = {
               in_query: "in",
               not_in_query: "not_in",
            };
            cond.rule = convert[cond.rule];
            cond.value = AB.uniq(ids); // use _.uniq() to only return unique values (no duplicates)

            // M:1 - filter __relation column in MySQL view with string
            if (linkCase == "many:one") {
               cond.rule = "contains";
               cond.value = ids[0] || "";
            }

            // if we didn't recover any values, then Simplify
            if (!cond.value || cond.value.length < 1) {
               // we need to negate this ...

               if (cond.rule == "in") {
                  // prevent any matches
                  cond.value = "0";
               } else {
                  // allow all matches
                  cond.value = "1";
               }

               cond.key = "1";
               cond.rule = "equals";
            }

            // final step, so parse another condition:
            parseQueryCondition(AB, where, object, userData, cb, req);
         }
      },
      req
   );
}

/**
 * findQueryEntry()
 * Perform a Depth First Search to find a rule that matches "in_query"
 * or "not_in_query".  Return the rule that is found, or NULL if  no
 * matches.
 * @param {obj} _where
 *       the QB condition object being evaluated
 * @return {obj|NULL}
 */
function findQueryEntry(_where) {
   if (!_where) return null;

   if (_where.rules) {
      var entry = null;
      for (var i = 0; i < _where.rules.length; i++) {
         entry = findQueryEntry(_where.rules[i]);
         if (entry) {
            return entry;
            // break;
         }
      }
      return entry;
   } else {
      if (_where.rule == "in_query" || _where.rule == "not_in_query") {
         return _where;
      } else {
         return null;
      }
   }
}

/**
 * parseQueryCondition()
 * Find a Rule entry and convert it.  If none found, then return from
 * our filter.
 * @param {ABFactory} AB
 *        the tenant based ABFactory for this Request
 * @param {obj} where
 *        the QB condition object being evaluated
 * @param {ABObject|ABObjectQuery} object
 *        the ABObjectXXX object evaluating the query conditions.
 * @param {obj} userData
 *        Any specific information relate to the user making this request.
 * @param {fn} cb
 *        The node style callback(err, data) for this process.
 * @param {ABUtil.request} req
 *        The request object that represents this job.
 */
function parseQueryCondition(AB, where, object, userData, cb, req) {
   var cond = findQueryEntry(where);
   if (!cond) {
      cb();
   } else {
      // make sure we find our QueryObject
      // var QueryObj = object.application.queries((q)=>{ return q.id == cond.value; })[0];
      var QueryObj = AB.objectByID(cond.value);
      if (!QueryObj) {
         QueryObj = AB.queryByID(cond.value);
      }
      if (!QueryObj) {
         var err = AB.toError(
            "Could not find specified query object.",
            "Unknown Query ID in condition.",
            {
               location: "ABModelConvertQueryConditions",
               qid: cond.value,
               condition: cond,
            }
         );
         cb(err);
         return;
      } else {
         var queryColumn;
         // {string} this is the 'tablename'.'colname' of the data to return

         var newKey = cond.key;
         // {string} this is the colName of the condition statement we want to pass
         // on.  So for instance, if the condition we received was the 'this_object',
         // filter, then we want the final condition to be:  id IN [],  and the
         // QB condition would be:  { key:'id', rule:'in', value:[] }.  So newKey == 'id'

         var parseColumn = cond.key;
         // {string} this is the column we want our reference query to return so we can
         // pull out the data for this filter condition.  So for example, the current query
         // is returning userid and subaccount.id.  However our filter is filtering on
         // subaccount.accountNum.  So we need to pull our 'accountNum' from the query.

         // if this is our special 'this_object' 'in_query'  queryID  filter:
         if (cond.key == "this_object") {
            if (!QueryObj.canFilterObject(object)) {
               var err2 = AB.toError("Object not filterable by Query.", {
                  location: "ABModelConvertQueryConditions",
                  object: object.toObj(),
                  queryObj: QueryObj.toObj(),
               });
               cb(err2);
               return;
            }

            let alias = QueryObj.objectAlias(object.id);

            queryColumn = `${alias}.${object.PK()}`;
            newKey = object.PK(); // 'id';  // the final filter needs to be 'id IN []', so 'id'
            parseColumn = object.PK(); // 'id';  // make sure we pull our 'id' values from the query

            continueSingle(
               AB,
               where,
               object,
               userData,
               cb,
               QueryObj,
               cond,
               newKey,
               queryColumn,
               "this_object",
               req
            );
         } else {
            // this is a linkField IN QUERY filter:

            // find field by it's name
            var field = object.fields((f) => {
               return f.columnName == cond.key;
            })[0];
            if (!field) {
               // ok, maybe we passed in a field.id:
               field = object.fieldByID(cond.key);
               if (!field) {
                  var err3 = AB.toError("Unable to resolve condition field.", {
                     location: "ABModelConvertQueryConditions",
                     field: cond.key,
                     condition: cond,
                  });
                  cb(err3);
                  return;
               }
            }

            // if get the field's linked object and see if it can be filtered:
            var linkedObject = field.datasourceLink;
            if (!QueryObj.canFilterObject(linkedObject)) {
               var err4 = AB.toError("Linked object not filterable by Query.", {
                  location: "ABModelConvertQueryConditions",
                  field: field.toObj(),
                  linkedObj: linkedObject.toObj(),
                  queryObj: QueryObj.toObj(),
               });
               cb(err4);
               return;
            } else {
               // based upon the type of link:
               var linkCase = field.linkType() + ":" + field.linkViaType();
               switch (linkCase.toLowerCase()) {
                  case "one:one":
                  case "one:many":
                     // this field is used in final filter condition
                     // let newKey = "";

                     // Johnny
                     // there are Query cases where we need to make sure the field is identified by
                     // it's dbTableName as well, to prevent 'Unknown Column' Errors.
                     // adding in the dbTableName since I think it will be safe in all situations ... maybe ..
                     if (object.objectAlias) {
                        newKey = `${object.objectAlias(field.object.id)}.${
                           field.columnName
                        }`;

                        parseColumn = field.indexField
                           ? field.indexField.columnName
                           : field.datasourceLink.PK();

                        // make this the queryColumn:
                        queryColumn = `${QueryObj.objectAlias(
                           field.datasourceLink.id
                        )}.${parseColumn}`;
                     }
                     // ABObject
                     else {
                        var dbTableName = field.object.dbTableName(true);
                        if (dbTableName) {
                           newKey = `${dbTableName}.${field.columnName}`;
                        }

                        parseColumn = field.indexField
                           ? field.indexField.columnName
                           : linkedObject.PK();

                        // make this the queryColumn:
                        queryColumn = `${QueryObj.objectAlias(
                           linkedObject.id
                        )}.${parseColumn}`;
                     }

                     continueSingle(
                        AB,
                        where,
                        object,
                        userData,
                        cb,
                        QueryObj,
                        cond,
                        newKey,
                        queryColumn,
                        linkCase,
                        req
                     );
                     break;

                  case "many:one":
                     // ABObjectQuery
                     if (object.objectAlias) {
                        newKey = `${object.objectAlias(
                           field.object.id
                        )}.${field.relationName()}`;

                        parseColumn = field.datasourceLink.PK();

                        queryColumn = `${QueryObj.objectAlias(
                           field.datasourceLink.id
                        )}.${parseColumn}`;
                     }
                     // ABObject
                     else {
                        newKey = field.indexField
                           ? field.indexField.columnName
                           : field.object.PK();

                        let dbTableName = field.object.dbTableName(true);
                        if (dbTableName) {
                           newKey = `${dbTableName}.${newKey}`;
                        }

                        parseColumn = field.indexField
                           ? field.indexField.columnName
                           : field.object.PK();

                        queryColumn = `${QueryObj.objectAlias(
                           field.object.id
                        )}.${parseColumn}`;
                     }

                     continueSingle(
                        AB,
                        where,
                        object,
                        userData,
                        cb,
                        QueryObj,
                        cond,
                        newKey,
                        queryColumn,
                        linkCase,
                        req
                     );
                     break;

                  // case 'many:one':
                  //     // they contain my .PK

                  //     // my .PK is what is used on our filter
                  //     newKey = object.PK(); // 'id';

                  //     if (object.objectAlias)
                  //         newKey = object.objectAlias(linkedObject.id) + '.' + newKey;

                  //     // I need to pull out the linkedField's columnName
                  //     parseColumn = linkedField.columnName;

                  //     // make this the queryColumn:
                  //     queryColumn = QueryObj.objectAlias(linkedObject.id)+'.'+linkedField.columnName;

                  //     continueSingle(cond, newKey, parseColumn, queryColumn);
                  //     break;

                  case "many:many":
                     // Transition Question:
                     // is this first case correct?  not sure that newKey is being
                     // generated correctly.
                     // or that we shouldn't be using field.datasourceLink.xxx instead.

                     // ABObjectQuery
                     if (object.objectAlias) {
                        debugger;
                        console.error(
                           "!!! FOUND A IN_QUERY with an object.objectAlias"
                        );

                        newKey = `${object.objectAlias(
                           field.object.id
                        )}.${field.object.PK()}`;

                        parseColumn = field.object.PK();

                        queryColumn = `${QueryObj.objectAlias(
                           field.object.id
                        )}.${parseColumn}`;
                     }
                     // ABObject
                     else {
                        // newKey = field.object.PK();

                        // let dbTableName = field.object.dbTableName(true);
                        // if (dbTableName) {
                        //    newKey = `${dbTableName}.${newKey}`;
                        // }

                        // parseColumn = field.object.PK();

                        // queryColumn = `${QueryObj.objectAlias(
                        //    field.object.id
                        // )}.${parseColumn}`;

                        // Q: does this need to be the current field.id?
                        // newKey = field.object.PK();

                        // let dbTableName = field.object.dbTableName(true);
                        // if (dbTableName) {
                        //    newKey = `${dbTableName}.${newKey}`;
                        // }

                        // on an M:N connection we need our condition to
                        // be a
                        // cond.key = this Connect field.id
                        // cond.rule = [in, not_in]
                        // cond.values = [ ids ]
                        //
                        newKey = field.id;

                        // the parseColumn is the data pulled from our
                        // datasourceLink
                        parseColumn = field.datasourceLink.PK();

                        // if this is a query, be sure to de-reference the
                        // object alias:
                        // BASE_OBJECT.[PK]
                        queryColumn = `${QueryObj.objectAlias(
                           field.datasourceLink.id
                        )}.${parseColumn}`;
                     }

                     continueSingle(
                        AB,
                        where,
                        object,
                        userData,
                        cb,
                        QueryObj,
                        cond,
                        newKey,
                        queryColumn,
                        linkCase,
                        req
                     );
                     break;
                  // case "many:many":
                  //    // we need the .PK of our linked column out of the given query
                  //    parseColumn = linkedObject.PK(); // 'id';
                  //    queryColumn =
                  //       QueryObj.objectAlias(linkedObject.id) +
                  //       "." +
                  //       parseColumn;

                  //    processQueryValues(
                  //       parseColumn,
                  //       queryColumn,
                  //       (err, ids) => {
                  //          if (err) {
                  //             cb(err);
                  //             return;
                  //          }

                  //          // then we need to get which of our PK is stored in the linkTable for those linked entries
                  //          var linkTableQuery = ABMigration.connection().queryBuilder();
                  //          var joinTableName = field.joinTableName(true);

                  //          // var parseName = object.name;
                  //          var parseName = field.object.name;
                  //          linkTableQuery
                  //             .select(parseName)
                  //             .distinct()
                  //             .from(joinTableName)
                  //             .where(linkedObject.name, "IN", ids)
                  //             .then((data) => {
                  //                var myIds = data
                  //                   .map((d) => {
                  //                      return d[parseName];
                  //                   })
                  //                   .filter((d) => d != null);
                  //                myIds = _.uniq(myIds);

                  //                var myPK = object.PK(); // 'id';

                  //                // if it is a query, then add alias
                  //                if (object.objectAlias)
                  //                   myPK =
                  //                      object.objectAlias(field.object.id) +
                  //                      "." +
                  //                      field.object.PK(); // 'alias'.'id';

                  //                buildCondition(myPK, myIds);
                  //             })
                  //             .catch((err) => {
                  //                cb(err);
                  //             });
                  //       }
                  //    );
                  //    break;
               }
            }
         }

         // buildCondition
         // final step of recreating the condition into the
         // proper Field IN []  format;
         // function buildCondition(newKey, ids, linkCase) {
         //    // convert cond into an IN or NOT IN
         //    cond.key = newKey;
         //    var convert = {
         //       in_query: "in",
         //       not_in_query: "not_in",
         //    };
         //    cond.rule = convert[cond.rule];
         //    cond.value = AB.uniq(ids); // use _.uniq() to only return unique values (no duplicates)

         //    // M:1 - filter __relation column in MySQL view with string
         //    if (linkCase == "many:one") {
         //       cond.rule = "contains";
         //       cond.value = ids[0] || "";
         //    }

         //    // sails.log.info(".... new Condition:", cond);

         //    // final step, so parse another condition:
         //    parseQueryCondition(AB, _where, object, userData, cb, req);
         // }
      } // if !QueryObj
   } // if !cond
}
