/*
 * ABQLSetPluck
 *
 * An ABQLSetPluck can process a set (array) of data and puck out a specified
 * field from each row to then make an array of values that only contain that 
 * field.
 * 
 * Example: 
array = [
 {
   name: "Neo",
   email: "neo@thematrix.com",
   relationships: [ { morpheous}, {trinity} ]
 },
 {
   name: "trinity",
   email: "trinity@thematrix.com",
   relationships: [ {neo}, {morpheous} ]
 },
 {
   name: "morpheous",
   email: "morpheous@thematrix.com",
   relationships: [ {neo}, {trinity}]
 }

]

pluck("email") :
   [
      "neo@thematrix.com",
      "trinity@thematrix.com",
      "morpheous@thematrix.com"
   ]

pluck("relationships"):
   [
      {neo},
      {trinity},
      {morpheous}
   ]
 *
 */

const ABQLSetPluckCore = require("../../core/ql/ABQLSetPluckCore.js");

class ABQLSetPluck extends ABQLSetPluckCore {
   // constructor(attributes, prevOP, task, application) {
   //     super(attributes, [], prevOP, task, application);
   // }
   ///
   /// Instance Methods
   ///

   /**
    * do()
    * perform the action for this Query Language Operation.
    * @param {Promise} chain
    *        The incoming Promise that we need to extend and use to perform
    *        our action.
    * @param {obj} instance
    *        The current process instance values used by our tasks to store
    *        their state/values.
    * @param {Knex.Transaction?} trx
    *        (optional) Knex Transaction instance.
    * @param {ABUtil.reqService} req
    *        an instance of the current request object for performing tenant
    *        based operations.
    * @return {Promise}
    */
   do(chain, instance, trx, req) {
      if (!chain) {
         throw new Error("ABQLSetPluck.do() called without a Promise chain!");
      }

      // capture the new promise from the .then() and
      // return that as the next link in the chain
      var nextLink = chain.then(async (context) => {
         var nextContext = {
            label: "ABQLSetPluck",
            object: context.object,
            data: null,
            prev: context,
         };

         if (!context.data) {
            // weird!  pass along our context with data == null;
            nextContext.log = "no data set! can't setPluck() of null.";
            return nextContext;
         }

         // make sure we are working with an Array
         if (Array.isArray(context.data)) {
            if (this.fieldID == "_PK") {
               let pkName = context.object.primaryColumnName || "uuid";
               let newData = [];
               context.data.forEach((d) => {
                  if (d) {
                     newData.push(d[pkName]);
                  }
               });
               nextContext.data = newData;
               return nextContext;
            }

            // make sure we have a reference to our .field
            if (!this.field) {
               this.field = this.object.fieldByID(this.fieldID);
            }
            if (!this.field) {
               // whoops!
               throw new Error(
                  "ABQLSetPluck.do(): unable to resolve .fieldID.",
               );
            }

            // CASE 1:  Connected Objects:
            if (this.field.isConnection) {
               // Pull relation value of this.field
               const rowIds = context.data.map((row) => row.id ?? row.uuid);
               const data = await req.retry(() =>
                  context.object.model().findAll(
                     {
                        where: {
                           glue: "and",
                           rules: [
                              {
                                 key: context.object.PK(),
                                 rule: "in",
                                 value: this.AB.uniq(rowIds),
                              },
                           ],
                        },
                        populate: [this.field.columnName],
                     },
                     null,
                     req,
                  ),
               );

               var linkObj = this.field.datasourceLink;
               var PK = linkObj.PK();

               // we need to go lookup the connected values:
               var ids = [];
               data.forEach((d) => {
                  var entry = this.field.dataValue(d);
                  if (!Array.isArray(entry)) entry = [entry];
                  entry.forEach((e) => {
                     var id = e[PK] || e;
                     if (id) {
                        ids.push(id);
                     }
                  });
               });

               const cond = {
                  glue: "or",
                  rules: [],
               };
               if (ids?.length) {
                  cond.rules.push({
                     key: PK,
                     rule: "in",
                     value: this.AB.uniq(ids),
                  });
                  if (this.field?.indexField) {
                     cond.rules.push({
                        key: this.field.indexField.id,
                        rule: "in",
                        value: this.AB.uniq(ids),
                     });
                  }
                  if (this.field?.indexField2) {
                     cond.rules.push({
                        key: this.field.indexField2.id,
                        rule: "in",
                        value: this.AB.uniq(ids),
                     });
                  }
               }

               return new Promise((resolve, reject) => {
                  req.retry(() =>
                     linkObj.model().find({ where: cond, populate: true }, req)
                  )
                     .then((rows) => {
                        // Special Formatting for Form.io fields.
                        // Allow displaying connected data that has been .format()ed
                        // find any connectedObjects
                        var linkedConnections = linkObj.connectFields();
                        (linkedConnections || []).forEach((f) => {
                           // for each row
                           (rows || []).forEach((r) => {
                              // insert a formatted entry
                              r[`${f.columnName}.format`] = f.format(r);
                           });
                        });
                        // Calculate and TextFormula fields do not have stored
                        // values so we need to run .format() for each instance
                        var fieldsToFormat = ["calculate", "TextFormula"];
                        var formatFields = linkObj.fields((f) => {
                           return fieldsToFormat.indexOf(f.key) != -1;
                        });
                        (formatFields || []).forEach((f) => {
                           // for each row
                           (rows || []).forEach((r) => {
                              // insert a formatted entry
                              r[f.columnName] = f.format(r);
                           });
                        });

                        // Reduce the size of relation data to prevent excessive data in the SITE_PROCESS_INSTANCE table.
                        (linkedConnections || []).forEach((f) => {
                           (rows || []).forEach((r) => {
                              if (Array.isArray(r[f.relationName()])) {
                                 r[f.relationName()] = r[f.relationName()].map((rItem) => {
                                    return {
                                       id: rItem.id,
                                       uuid: rItem.uuid,
                                    };
                                 });
                              }
                              else if (r[f.relationName()]) {
                                 r[f.relationName()] = {
                                    id: r[f.relationName()].id,
                                    uuid: r[f.relationName()].uuid,
                                 };
                              }
                           });
                        });

                        nextContext._condition = cond;
                        nextContext.object = linkObj;
                        nextContext.data = rows;
                        resolve(nextContext);
                     })
                     .catch((err) => {
                        reject(err);
                     });
               });
            }

            // CASE 2: pluck out single values:
            var newData = [];
            context.data.forEach((d) => {
               newData.push(this.field.dataValue(d));
            });
            nextContext.data = newData;
            return nextContext;
         } else {
            // this shouldn't happen!
            throw new Error("ABQLSetPluck.do() called on non Array of data.");
         }
      });

      if (this.next) {
         return this.next.do(nextLink, instance, trx, req);
      } else {
         return nextLink;
      }
   }
}

module.exports = ABQLSetPluck;
