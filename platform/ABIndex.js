const ABIndexCore = require("../core/ABIndexCore");

module.exports = class ABIndex extends ABIndexCore {
   constructor(attributes, object) {
      super(attributes, object);
   }

   /**
    * @method exportIDs()
    * export any relevant .ids for the necessary operation of this ABIndex.
    * @param {array} ids
    *         the array of relevant ids to store our .ids into.
    */
   exportIDs(ids) {
      // make sure we don't get into an infinite loop:
      if (ids.indexOf(this.id) > -1) return;

      ids.push(this.id);

      // include my fields:
      (this.fields || []).forEach((f) => {
         if (f.exportIDs) f.exportIDs(ids);
      });
   }

   ///
   /// DB Migrations
   ///

   /**
    * migrateCheckIsCorrect()
    * verify the current definition of the table matches what our
    * definition expectes it to be.
    * @param {Knex} knex
    *        the Knex connection that represents our {ABObject}
    * @return {Promise}
    *         resolves with a {bool} isCorrect?
    */
   migrateCheckIsCorrect(knex) {
      let indexName = this.indexName.toLowerCase();
      // {string} indexName
      // this is what we are intending to create an index
      // NOTE: we are lowercase()ing the values to be sure we don't
      // miss matching the index names.  (they are case insensitive)

      let tableName = this.object.dbTableName();
      // {string}
      // the name of the DB table where the index will be created

      let columnNames = this.fields.map((f) => f.columnName);
      // {array}
      // an array of the possible column names that make up this index

      let hashColumns = {
         /* columnName : {bool} true if there */
      };
      // {hash} hashColumns
      // should contain an entry for each expected column in our definition.

      // set each column has to false, and let the returned data set to true.
      columnNames.forEach((c) => {
         hashColumns[c] = false;
      });

      return knex.schema
         .raw(`SHOW INDEXES FROM ${tableName}`)
         .then((data) => {
            let isCorrect = columnNames.length == 0;
            // {bool} isCorrect
            // the final result of whether or not this table has a correct
            // implementation of this ABIndex definition.
            // the only case we might assume we are "correct" if there is
            // no data returned, is if our definition currently has no
            // columns assigned.  So we start off = columnNames.length == 0;

            let rows = data[0];
            if (rows) {
               let existingColumns = [];
               // {array} existingColumns
               // an array of column names that exist as a part of the current
               // definition.  This will help us catch columns that have been
               // removed from our ABIndex configuration.

               // foreach INDEX definition
               rows.forEach((row) => {
                  // if this entry represents THIS index, track this column
                  if ((row["Key_name"] || "").toLowerCase() === indexName) {
                     var col = row["Column_name"];
                     existingColumns.push(col);
                     hashColumns[col] = true;
                  }
               });

               isCorrect = true;
               // start by assuming true and look for examples where it
               // isn't

               // verify all the expected columns existed in the data
               // none of our hashColumns values can be false;
               Object.keys(hashColumns).map((k) => {
                  isCorrect = isCorrect && hashColumns[k];
               });

               // make sure there is no additional column in the data:
               // each of the columns returned need to exist in our columnNames
               existingColumns.forEach((col) => {
                  isCorrect = isCorrect && columnNames.indexOf(col) > -1;
               });
            }

            return isCorrect;
         })
         .catch((err) => {
            console.error(
               `ABIndex.migrateCheckExists(): Table[${tableName}] Column[${columnNames.join(
                  ", "
               )}] Index[${indexName}] `,
               err
            );
            // throw err;
         });
   }

   migrateCreate(req, knex) {
      knex = knex || this.AB.Knex.connection(this.object.connName);
      if (this.fields == null || !this.fields.length) {
         req.notify.builder(
            new Error(
               `ABIndex[${this.name}][${this.id}] defined with no fields referenced`
            ),
            {
               context: "ABIndex.migrateCreate()",
               field: this,
               AB: this.AB,
            }
         );
         return Promise.resolve();
      }
      let indexName = this.indexName;
      let tableName = this.object.dbTableName();
      let columnNames = this.fields.map((f) => f.columnName);

      return (
         Promise.resolve()
            // Clear Index
            // .then(() => this.migrateDrop(knex))
            .then(() => this.migrateCheckIsCorrect(knex))
            .then((isCorrect) => {
               if (isCorrect) return;

               return knex.schema.alterTable(tableName, (table) => {
                  // Create new Unique to table
                  if (this.unique) {
                     // Create Unique & Index
                     return Promise.resolve().then(() => {
                        // NOTE: additional Promise.resolve() trying to catch a thrown error
                        //       with knex.schema.raw()
                        // Getting Error:
                        // TypeError: Cannot read property 'queryContext' of undefined
                        //  at Formatter.wrapAsIdentifier (/app/node_modules/knex/lib/formatter.js:190:39)
                        //  at Formatter.wrapString (/app/node_modules/knex/lib/formatter.js:288:27)
                        //  at Formatter.wrap (/app/node_modules/knex/lib/formatter.js:185:21)
                        //  at Formatter.columnize (/app/node_modules/knex/lib/formatter.js:77:19)
                        //  at /app/AppBuilder/platform/ABIndex.js:183:41
                        //
                        //  knex.client.formatter().columnize() :=> seems to be missing a '.builder'
                        //  object in it's context.  This is causing the error.
                        //
                        //  Q: Is there a proper way to ensure the .builder object is established
                        //     before we call this fn() ?
                        //
                        //       -> knex.queryBuilder().client.formatter().columnize() doesn't help.
                        //
                        //  A: current workaround (but not sure this is the RIGHT way to do it)
                        //       knex.client.wrapIdentifier() for each columnName:
                        // NOTE: using try{}catch(){} to help debug this problem:
                        // try {
                        return knex.schema
                           .raw(
                              `ALTER TABLE ${tableName} ADD UNIQUE INDEX ${indexName}(${columnNames
                                 .map((c) => knex.client.wrapIdentifier(c))
                                 .join(", ")})`
                           )
                           .catch((err) => {
                              // if it is a duplicate keyname error, this is probably already created?
                              if (err.code == "ER_DUP_KEYNAME") return;

                              // retry on Connection Error
                              if (req.shouldRetry(err)) {
                                 return this.migrateCreate(req, knex);
                              }

                              // otherwise we alert our developers
                              req.notify.developer(err, {
                                 context: `ABIndex.migrateCreate() Unique: Table[${tableName}] Column[${columnNames.join(
                                    ", "
                                 )}] Index[${indexName}] `,
                                 field: this,
                                 AB: this.AB,
                              });

                              throw err;
                           });
                        // } catch (err) {
                        //    req.notify.developer(err, {
                        //       context: `.CATCH():  ABIndex.migrateCreate() Unique: Table[${tableName}] Column[${columnNames.join(
                        //          ", "
                        //       )}] Index[${indexName}] `,
                        //       field: this,
                        //       AB: this.AB,
                        //    });
                        //    return Promise.resolve();
                        // }
                     });
                     // .catch((err) => {
                     //    // if it is a duplicate keyname error, this is probably already created?
                     //    if (err.code == "ER_DUP_KEYNAME") return;

                     //    // retry on Connection Error
                     //    if (req.shouldRetry(err)) {
                     //       return this.migrateCreate(req, knex);
                     //    }

                     //    // alert us of anything else:
                     //    req.notify.developer(err, {
                     //       context: `ABIndex.migrateCreate() Unique: Table[${tableName}] Column[${columnNames.join(
                     //          ", "
                     //       )}] Index[${indexName}] `,
                     //       field: this,
                     //       AB: this.AB,
                     //    });

                     //    throw err;
                     // });
                  }
                  // Create new Index
                  else {
                     // ALTER TABLE {tableName} ADD INDEX {indexName} ({columnNames})
                     return table.index(columnNames, indexName);
                     /*.catch((err) => {
                        // if it is a duplicate keyname error, this is probably already created?
                        if (err.code == "ER_DUP_KEYNAME") return;

                        req.notify.developer(err, {
                           context: `ABIndex.migrateCreate(): INDEX : Table[${tableName}] Column[${columnNames.join(
                              ", "
                           )}] Index[${indexName}] `,
                           field: this,
                           AB: this.AB,
                        });

                        throw err;
                     });
                     */
                  }
               });
            })
      );
   }

   migrateDrop(req, knex) {
      knex = knex || this.AB.Knex.connection(this.object.connName);
      if (this.fields == null || !this.fields.length) return Promise.resolve(); // TODO: refactor in v2

      let indexName = this.indexName;
      let tableName = this.object.dbTableName();
      // let columnNames = this.fields.map((f) => f.columnName);

      return new Promise((resolve, reject) => {
         knex.schema
            .raw(`ALTER TABLE ${tableName} DROP INDEX \`${indexName}\``)
            .then(() => resolve())
            .catch((err) => {
               // Not exists
               if (err.code == "ER_CANT_DROP_FIELD_OR_KEY") return resolve();

               // retry on Connection Error
               if (req.shouldRetry(err)) {
                  return this.migrateDrop(req, knex).then(() => resolve());
               }

               req.notify.developer(err, {
                  context: `ABIndex.migrateDrop(): Table[${tableName}] Index[${indexName}] `,
                  tableName,
                  indexName,
                  field: this,
                  AB: this.AB,
               });

               reject(err);
            });
      });

      // return new Promise((resolve, reject) => {
      //    knex.schema
      //       .table(tableName, (table) => {
      //          // Drop Unique
      //          if (this.unique) {
      //             table.dropUnique(columnNames, this.uniqueName);
      //          }

      //          // Drop Index
      //          table.dropIndex(columnNames, indexName);
      //       })
      //       .catch((err) => {
      //          console.error(err);
      //          resolve();
      //       })
      //       .then(() => resolve());
      // });
   }
};
