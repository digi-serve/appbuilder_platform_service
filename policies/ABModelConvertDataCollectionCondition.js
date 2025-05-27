/**
 * ABModelConvertDataCollectionCondition
 *
 * @module      :: Policy
 * @description :: Scan any provided conditions to see if we have a 'in_data_collection'
 *                 or 'not_in_data_collection' clause.  If we do, convert it to an IN or NOT IN
 *                 clause. The assumption is that the current object is in this data collection.
 * @docs        :: http://sailsjs.org/#!documentation/policies
 *
 */

module.exports = function (AB, where, object, userData, next, req) {
   // Transition: AB, where, object, userConditions

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

function findDcEntry(_where) {
   if (!_where) return null;

   if (_where.rules) {
      var entry = null;
      for (var i = 0; i < _where.rules.length; i++) {
         entry = findDcEntry(_where.rules[i]);
         if (entry) {
            return entry;
            break;
         }
      }
      return entry;
   } else {
      if (
         _where.rule == "in_data_collection" ||
         _where.rule == "not_in_data_collection"
      ) {
         return _where;
      } else {
         return null;
      }
   }
}

function parseQueryCondition(AB, _where, object, userData, cb, req) {
   var cond = findDcEntry(_where);
   if (!cond) {
      cb();
   } else {
      // NOTE: on the server, Application.datacollection*() methods do not return
      // datacollections.  (for now).  So we need to pull the definition of the dv
      // here:
      // var dv = Application.datacollectionByID(cond.value);
      var defDC = AB.definitionByID(cond.value);

      Promise.resolve().then(() => {
         if (!defDC) {
            var err = AB.toError("Unknown Data collection ID in condition.", {
               location: "ABModelConvertDataCollectionCondition",
               dcId: cond.value,
               condition: cond,
            });
            cb(err);
            return;
         }

         // var sourceObject = object.application.objects(obj => obj.id == dc.settings.object)[0];
         var sourceObject = AB.objectByID(defDC.settings.datasourceID);
         if (!sourceObject) {
            var err = AB.toError("Source object does not exist.", {
               location: "ABModelConvertDataCollectionCondition",
               sourceObjectID: defDC.settings.datasourceID,
               dcID: defDC.id,
            });
            cb(err);
            return;
         }

         var objectColumn;
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

         // if this is our special 'this_object' 'in_data_collection'  queryID  filter:
         if (cond.key == "this_object") {
            objectColumn =
               (cond.alias ? cond.alias : object.dbTableName(true)) +
               "." +
               object.PK();
            newKey = `\`${object.dbTableName()}\`.\`${object.PK()}\``; // 'id';  // the final filter needs to be 'id IN []', so 'id'
            parseColumn = object.PK(); // 'id';  // make sure we pull our 'id' values from the query

            continueSingle(
               newKey,
               parseColumn,
               objectColumn,
               cond.linkCond,
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
                  var err = AB.toError("Unable to resolve condition field.", {
                     location: "ABModelConvertDataCollectionCondition",
                     field: cond.key,
                     condition: cond,
                  });
                  cb(err);
                  return;
               }
            }

            // get the linked field:
            var linkedField = field.fieldLink;

            // based upon the type of link:
            var linkCase = field.linkType() + ":" + field.linkViaType();
            switch (linkCase.toLowerCase()) {
               case "one:one":
               case "one:many":
                  // this field is used in final filter condition
                  newKey = `\`${field.object.dbTableName()}\`.\`${
                     field.columnName
                  }\``;

                  // I need to pull out the PK from the filter Query:
                  parseColumn = sourceObject.PK(); // 'id';

                  // custom index
                  if (field.indexField) {
                     parseColumn = field.indexField.columnName;
                  }

                  // make this the queryColumn:
                  objectColumn =
                     sourceObject.dbTableName(true) + "." + parseColumn;
                  continueSingle(
                     newKey,
                     parseColumn,
                     objectColumn,
                     cond.linkCond,
                     req
                  );
                  break;

               case "many:one":
                  // they contain my .PK

                  // my .PK is what is used on our filter
                  newKey = `\`${object.dbTableName()}\`.\`${object.PK()}\``; // 'id';

                  // custom index
                  if (field.indexField) {
                     newKey = field.indexField.columnName;
                  }

                  // I need to pull out the linkedField's columnName
                  parseColumn = linkedField.columnName;

                  // make this the queryColumn:
                  objectColumn =
                     sourceObject.dbTableName(true) + "." + parseColumn;
                  continueSingle(
                     newKey,
                     parseColumn,
                     objectColumn,
                     cond.linkCond,
                     req
                  );
                  break;

               case "many:many":
                  // we need the .PK of our linked column out of the given query
                  parseColumn = sourceObject.PK(); // 'id';

                  // custom index
                  if (
                     field.indexField &&
                     field.indexField.object.id == sourceObject.id
                  ) {
                     parseColumn = field.indexField.columnName;
                  } else if (
                     field.indexField2 &&
                     field.indexField2.object.id == sourceObject.id
                  ) {
                     parseColumn = field.indexField2.columnName;
                  }

                  objectColumn =
                     sourceObject.dbTableName(true) + "." + parseColumn;

                  processQueryValues(
                     parseColumn,
                     objectColumn,
                     cond.linkCond,
                     (err, ids) => {
                        if (err) {
                           cb(err);
                           return;
                        }

                        // then we need to get which of our PK is stored in the linkTable for those linked entries
                        var linkTableQuery =
                           AB.Knex.connection().queryBuilder();
                        var joinTableName = field.joinTableName(true);

                        var parseName = object.name;

                        linkTableQuery
                           .select(parseName)
                           .from(joinTableName)
                           .where(sourceObject.name, "IN", ids)
                           .then((data) => {
                              var myIds = data
                                 .map((d) => {
                                    return d[parseName];
                                 })
                                 .filter((d) => d != null);
                              myIds = AB.uniq(myIds);

                              var myPK = `${object.dbTableName()}.${object.PK()}`; // 'id';

                              // custom index
                              if (
                                 field.indexField &&
                                 field.indexField.object.id == object.id
                              ) {
                                 myPK = `${object.dbTableName()}.${
                                    field.indexField.columnName
                                 }`;
                              } else if (
                                 field.indexField2 &&
                                 field.indexField2.object.id == object.id
                              ) {
                                 myPK = `${object.dbTableName()}.${
                                    field.indexField2.columnName
                                 }`;
                              }

                              buildCondition(myPK, myIds, req);
                           })
                           .catch((err) => {
                              cb(err);
                           });
                     },
                     req
                  );
                  break;
            }
         }

         // buildCondition
         // final step of recreating the condition into the
         // proper Field IN []  format;
         function buildCondition(newKey, ids, req) {
            // convert cond into an IN or NOT IN
            cond.key = newKey;
            var convert = {
               in_data_collection: "in",
               not_in_data_collection: "not_in",
            };
            cond.rule = convert[cond.rule];
            cond.value = ids;

            // console.log(".... new Condition:", cond);

            // final step, so parse another condition:
            parseQueryCondition(AB, _where, object, userData, cb, req);
         }

         // processQueryValues
         // this step runs the specified Query and pulls out an array of
         // ids that can be used for filtering.
         // @param {string} parseColumn
         //        the name of the column of data to pull from the Query
         // @param {string} objectColumn
         //        [table].[column] format of the data to pull from Query
         // @param {fn} done
         //        a callback routine  done(err, data);
         function processQueryValues(
            parseColumn,
            objectColumn,
            cond,
            done,
            req
         ) {
            let where = defDC.settings.objectWorkspace.filterConditions || {
               glue: "and",
               rules: [],
            };
            if (cond) {
               if (cond.glue && where.rules.length == 0) {
                  where = cond;
               } else {
                  where.rules.push(cond);
               }
            }
            req.retry(() =>
               sourceObject.model().findAll(
                  {
                     columnNames: [objectColumn],
                     // {array} columnNames
                     // on ABObjectQuery : this limits what is returned from
                     // the query. Ignored on ABObject

                     where,
                     sort: defDC.settings.objectWorkspace.sortFields || [],
                  },
                  userData,
                  req
               )
            )
               .then((data) => {
                  // console.log(".... query data : ", data);
                  var ids = data
                     .map((d) => {
                        return d[parseColumn];
                     })
                     .filter((d) => d != null);
                  ids = AB.uniq(ids);

                  done(null, ids);
                  // buildCondition(newKey, ids);
               })
               .catch((err) => {
                  // this.AB.notify.developer(err, {
                  //    context: `ABModelConvertDataCollectionCondition:processQueryValues()`,
                  //    parseColumn,
                  //    objectColumn,
                  // });

                  var error = AB.toError("Error running query:", {
                     location: "ABModelConvertDataCollectionCondition",
                     message: err.toString(),
                     error: err,
                  });
                  done(error);
               });

            /*
 *  OLD Format:
 *
               var query = sourceObject.queryFind(
                  {
                     columnNames: [objectColumn],
                     where: defDC.settings.objectWorkspace.filterConditions,
                     sort: defDC.settings.objectWorkspace.sortFields || [],
                  },
                  req.user.data
               );
               // query.clearSelect().column(objectColumn);

               // sails.log.info();
               // sails.log.info('converted query sql:', query.toSQL());

               query
                  .then((data) => {
                     // console.log(".... query data : ", data);
                     var ids = data
                        .map((d) => {
                           return d[parseColumn];
                        })
                        .filter((d) => d != null);
                     ids = AB.uniq(ids);

                     done(null, ids);
                     // buildCondition(newKey, ids);
                  })
                  .catch((err) => {
                     var error = AB.toError("Error running query:", {
                        location: "ABModelConvertDataCollectionCondition",
                        message: err.toString(),
                        error: err,
                     });
                     done(error);
                  });
 */
         }

         // continueSingle
         // in 3 of our 4 cases we only need to run a single Query to
         // finish our conversion.
         function continueSingle(newKey, parseColumn, queryColumn, cond, req) {
            processQueryValues(
               parseColumn,
               queryColumn,
               cond,
               (err, ids) => {
                  if (err) {
                     cb(err);
                  } else {
                     buildCondition(newKey, ids, req);
                  }
               },
               req
            );
         }
      });
   } // if !cond
}
