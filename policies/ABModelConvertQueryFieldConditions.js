/**
 * ABModelConvertQueryFieldConditions
 *
 * @module      :: Policy
 * @description :: Scan any provided conditions to see if we have a 'in_query_field'
 *                 or 'not_in_query_field' clause.  If we do, convert it to an IN or NOT IN
 *                 clause. This will filter by the selected field.
 * @docs        :: http://sailsjs.org/#!documentation/policies
 *
 */

const ABFieldDate = require("../platform/dataFields/ABFieldDate.js");
const ABFieldUser = require("../platform/dataFields/ABFieldUser");

/**
 * ABModelConvertQueryFieldConditions()
 * Reduce any given "IN QUERY FIELD" rules to values that match the current
 * USER and state of the Data.
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
module.exports = function (AB, where, object, userData, next) {
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

   parseQueryCondition(AB, where, object, userData, (err) => {
      next(err);
   });
};

/**
 * processQuery()
 * perform the actual Query lookup that we will use to simplify our
 * condition.
 * This code is brought out so we can Retry the query in the case of
 * a Timeout Error.  This routine will perform a given # of retries before
 * passing an error on.
 * @param {ABFactory} AB
 *       the tenant based ABFactory for this Request
 * @param {obj} where
 *       the QB condition object being evaluated
 * @param {ABObject|ABObjectQuery} object
 *       the ABObjectXXX object evaluating the query conditions.
 * @param {obj} userData
 *       Any specific information relate to the user making this request.
 * @param {fn} cb
 *       The node style callback(err, data) for this process.
 * @param {ABObject|ABObjectQuery} QueryObj
 *       The ABObjectXXX instance that should be running this query.
 * @param {obj} cond
 *       the specific condition rule being updated at the moment.
 * @param {ABFieldXXX} field
 *       The ABFieldXXX object being compared into the dest Query
 * @param {ABFieldXXX} queryField
 *       The ABFieldXXX object in the dest Query
 * @param {string} queryColumn
 *       [table].[column] format of the data to pull from Query
 * @param {fn} done
 *       a callback routine  done(err, data);
 * @param {int} numRetries
 *       a running count of how many times this query has been attempted.
 */
function processQuery(
   AB,
   userData,
   QueryObj,
   cond,
   field,
   queryField,
   queryColumn,
   cb,
   numRetries = 1
) {
   // run the Query, and parse out that data
   // var query = null;
   QueryObj.model()
      .findAll(
         {
            columnNames: [queryColumn],
            ignoreIncludeId: true, // we want real id
         },
         userData
      )
      .then((data) => {
         // sails.log.info(".... query data : ", data);
         var values = data
            .map((d) => {
               // let result = d[queryField.columnName];
               let result = d[queryColumn];
               if (!result) return null;

               // Convert SQL data time format
               if (queryField instanceof ABFieldDate) {
                  return queryField.toSQLFormat(result);
               } else {
                  return result;
               }
            })
            .filter((val) => val != null);

         // modify the condition to be the IN condition
         // convert cond into an IN or NOT IN
         cond.key = "{prefix}.`{columnName}`"
            .replace("{prefix}", field.dbPrefix())
            .replace("{columnName}", field.columnName);
         var convert = {
            in_query_field: "in",
            not_in_query_field: "not_in",
            in: "in",
            not_in: "not_in",
         };
         cond.rule = convert[cond.rule];

         // Multiple users, then return id of user array
         if (
            queryField instanceof ABFieldUser &&
            queryField.settings.isMultiple
         ) {
            let users = [];

            (values || []).forEach((u) => {
               if (typeof u == "string") {
                  try {
                     u = JSON.parse(u);
                  } catch (e) {}
               }

               (u || [])
                  .map((u) => u.id || u)
                  .forEach((username) => users.push(username));
            });

            values = users;
         }

         cond.value = AB.uniq(values);

         // final step, so parse another condition:
         cb();
      })
      .catch((err) => {
         // Retry if the error was a Time Out:
         var errString = err.toString();
         if (errString.indexOf("ETIMEDOUT") > -1) {
            if (numRetries <= 5) {
               processQuery(
                  AB,
                  userData,
                  QueryObj,
                  cond,
                  field,
                  queryField,
                  queryColumn,
                  cb,
                  numRetries + 1
               );

               return;
            }
         }

         var error = AB.toError("Error running query:", {
            location: "ABModelConvertQueryFieldConditions",
            sql: err._sql || "-- unknown --",
            numRetries: numRetries,
            error: err,
         });

         cb(error);
      });
} // end ProcessQuery()

/**
 * findQueryEntry()
 * Perform a Depth First Search to find a rule that matches "in_query_field"
 * or "not_in_query_field".  Return the rule that is found, or NULL if  no
 * matches.
 * @param {obj} where
 *       the QB condition object being evaluated
 * @return {obj|NULL}
 */
function findQueryEntry(where) {
   if (where.rules) {
      var entry = null;
      for (var i = 0; i < where.rules.length; i++) {
         entry = findQueryEntry(where.rules[i]);
         if (entry) {
            return entry;
            // break;
         }
      }
      return entry;
   } else {
      if (
         where.rule == "in_query_field" ||
         where.rule == "not_in_query_field"
      ) {
         return where;
      } else {
         return null;
      }
   }
}

/**
 * parseQueryCondition()
 * Find a Rule entry and convert it.  When no more are found, then return from
 * our filter.
 * @param {ABFactory} AB
 *       the tenant based ABFactory for this Request
 * @param {obj} where
 *       the QB condition object being evaluated
 * @param {ABObject|ABObjectQuery} object
 *       the ABObjectXXX object evaluating the query conditions.
 * @param {obj} userData
 *       Any specific information relate to the user making this request.
 * @param {fn} cb
 *       The node style callback(err, data) for this process.
 */
function parseQueryCondition(AB, where, object, userData, cb) {
   var cond = findQueryEntry(where);
   if (!cond) {
      cb();
   } else {
      // make sure our value can be divided into query and field ids by a ":"
      var values = cond.value.split(":");
      if (values.length < 2) {
         var err = AB.toError("Value was not properly formated.", {
            location: "ABModelConvertQueryFieldConditions",
            value: cond.value,
            condition: cond,
         });
         cb(err);
         return;
      }
      var queryID = values[0];
      var queryFieldID = values[1];
      if (!queryID || !queryFieldID) {
         var err2 = AB.toError("Value was not properly formated.", {
            location: "ABModelConvertQueryFieldConditions",
            queryID: queryID,
            queryFieldID: queryFieldID,
            condition: cond,
         });
         cb(err2);
         return;
      }

      // make sure we find our QueryObject
      // var QueryObj = object.application.queries((q)=>{ return q.id == queryID; })[0];
      var QueryObj = AB.objectByID(queryID);
      if (!QueryObj) {
         QueryObj = AB.queryByID(queryID);
      }
      if (!QueryObj) {
         var err3 = AB.toError(
            "Could not find specified query object.",
            "Unknown Query ID in condition.",
            {
               location: "ABModelConvertQueryFieldConditions",
               qid: queryID,
               condition: cond,
            }
         );
         cb(err3);
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

         // TODO:
         // TRANSITION:
         // looks like we never defined continueSingle() in this policy. Check to see
         // if this_object + in_query_field  is a valid condition, if so, we need to
         // define this.  If not: remove this check:

         // if this is our special 'this_object' 'in_query_field'  queryID  filter:
         if (cond.key == "this_object") {
            queryColumn = object.dbTableName(true) + "." + object.PK();
            newKey = object.PK(); // 'id';  // the final filter needs to be 'id IN []', so 'id'
            parseColumn = object.PK(); // 'id';  // make sure we pull our 'id' values from the query

            continueSingle(newKey, parseColumn, queryColumn);
         } else {
            // this is a linkField IN QUERY filter:

            // find field by it's name
            var field = object.fields(
               (f) => f.columnName == cond.key || f.id == cond.key
            )[0];
            if (!field) {
               var err4 = AB.toError("Unable to resolve condition field.", {
                  location: "ABModelConvertQueryFieldConditions",
                  field: cond.key,
                  condition: cond,
               });
               cb(err4);
               return;
            }

            // get the Query Field we want to pull out
            var queryField = QueryObj.fields(
               (f) => (f.field ? f.field.id : f.id) == queryFieldID
            )[0];
            if (!queryField) {
               var err5 = AB.toError("Unable to resolve query field.", {
                  location: "ABModelConvertQueryFieldConditions",
                  fieldID: queryFieldID,
                  condition: cond,
               });
               cb(err5);
               return;
            }

            // get the query field's object and column name
            let columnName =
               queryField.dbPrefix().replace(/`/g, "") +
               "." +
               queryField.columnName;

            processQuery(
               AB,
               userData,
               QueryObj,
               cond,
               field,
               queryField,
               columnName,
               (err) => {
                  if (err) {
                     cb(err);
                     return;
                  }
                  parseQueryCondition(AB, where, object, userData, cb);
               }
            );
         }
      } // if !QueryObj
   } // if !cond
}
