/*
 * ABFieldConnect
 *
 * An ABFieldConnect defines a connect to other object field type.
 *
 */

const path = require("path");
const async = require("async");
const _ = require("lodash");
// prettier-ignore
const ABFieldConnectCore = require(path.join(__dirname, "..", "..", "core", "dataFields", "ABFieldConnectCore.js"));

/**
 * @method getJunctionInfo
 * @param {string} objectName
 * @param {string} linkObjectName
 *
 * @return {Object} {
 * 		tableName {string},
 * 		sourceColumnName {string},
 * 		targetColumnName {string}
 * }
 */
function getJuntionInfo(objectName, linkObjectName) {
   var sourceModel = _.filter(
      sails.models,
      (m) => m.tableName == objectName,
   )[0];
   var targetModel = _.filter(
      sails.models,
      (m) => m.tableName == linkObjectName,
   )[0];
   var juntionModel = _.filter(sails.models, (m) => {
      return (
         m.meta.junctionTable && // true / false
         // definition: {
         //	id: {
         //		primaryKey: true,
         // 	 	unique: true,
         // 	 	autoIncrement: true,
         // 	 	type: 'integer'
         //	},
         //  permissionaction_roles: {
         //		type: 'integer',
         // 	 	foreignKey: true,
         // 	 	references: 'permissionaction',
         // 	 	on: 'id',
         // 	 	via: 'permissionrole_actions'
         //	},
         //  permissionrole_actions: {
         //		type: 'integer',
         // 	 	foreignKey: true,
         // 	 	references: 'permissionrole',
         // 	 	on: 'id',
         // 	 	via: 'permissionaction_roles'
         //	} }
         _.filter(m.definition, (def) => {
            return (
               def.foreignKey == true &&
               (def.references == sourceModel.identity ||
                  def.references == targetModel.identity)
            );
         }).length >= 2
      );
   })[0];

   // Get columns info
   var sourceColumnName = _.filter(
         juntionModel.definition,
         (def) =>
            def.foreignKey == true && def.references == sourceModel.identity,
      )[0].via,
      targetColumnName = _.filter(
         juntionModel.definition,
         (def) =>
            def.foreignKey == true && def.references == targetModel.identity,
      )[0].via;

   return {
      tableName: juntionModel.tableName,
      sourceColumnName: sourceColumnName,
      targetColumnName: targetColumnName,
   };
}

module.exports = class ABFieldConnect extends ABFieldConnectCore {
   constructor(values, object) {
      super(values, object);
   }

   ///
   /// Instance Methods
   ///

   isValid() {
      var errors = super.isValid();

      // errors = OP.Form.validationError({
      // 	name:'columnName',
      // 	message:L('ab.validation.object.name.unique', 'Field columnName must be unique (#name# already used in this Application)').replace('#name#', this.name),
      // }, errors);

      return errors;
   }

   /**
    * @method exportData()
    * export the relevant data from this object necessary for the operation of
    * it's associated application.
    * @param {hash} data
    *        The incoming data structure to add the relevant export data.
    *        .ids {array} the ABDefinition.id of the definitions to export.
    *        .siteObjectConnections {hash} { Obj.id : [ ABField.id] }
    *                A hash of Field.ids for each System Object that need to
    *                reference these importedFields
    *        .roles {hash}  {Role.id: RoleDef }
    *                A Definition of a role related to this Application
    *        .scope {hash} {Scope.id: ScopeDef }
    *               A Definition of a scope related to this Application.
    *               (usually from one of the Roles being included)
    */
   exportData(data) {
      super.exportData(data);

      // include the connected object with this.
      var connObj = this.datasourceLink;
      if (
         connObj &&
         (!connObj.isSystemObject || data.settings.includeSystemObjects)
      ) {
         connObj.exportData(data);
      } else {
         // we have a field connected to a System Object:
         // gather that field data and include it.
         var linkField = this.fieldLink;
         if (linkField) {
            // Make sure fieldLink's definition is added:
            linkField.exportData(data);

            // and register it under the siteObjectConnections
            let soc = data.siteObjectConnections;
            soc[connObj.id] = soc[connObj.id] || [];
            soc[connObj.id].push(linkField.id);
         }
      }
   }

   /**
    * @method exportIDs()
    * export any relevant .ids for the necessary operation of this application.
    * @param {array} ids
    *        the array of ids to store our relevant .ids into
    */
   exportIDs(ids) {
      super.exportIDs(ids);

      // include datasource with this:
      // Q?: so, when exporting ids ... do we ensure we gather all connected fields?
      var connObj = this.datasourceLink;
      if (connObj) {
         connObj.exportIDs(ids);
      }
   }

   getConstraintName(tableName, columnName) {
      return (
         this.AB.rules.toJunctionTableFK(tableName, columnName) || ""
      ).replace(/[^a-zA-Z0-9\_]/g, "");
   }

   ///
   /// DB Migrations
   ///

   /**
    * @function migrateCreate
    * perform the necessary sql actions to ADD this column to the DB table.
    * @param {ABUtil.reqService} req
    *        the request object for the job driving the migrateCreate().
    * @param {knex} knex
    *        the Knex connection.
    */
   migrateCreate(req, knex) {
      knex = knex || this.AB.Knex.connection(this.object.connName);
      return new Promise((resolve, reject) => {
         let tableName = this.object.dbTableName(true);

         // find linked object
         let linkObject = this.datasourceLink;
         if (!linkObject) {
            // Builder Notification already published in this.datasourceLink
            var err = new Error(
               `Error: ABFieldConnect.migrateCreate(): Unable to find datasourceLink for object[${this.object.label}]->field[${this.label}][${this.id}]`,
            );
            return reject(err);
         }
         let linkKnex = this.AB.Knex.connection(linkObject.connName);

         let linkTableName = linkObject.dbTableName(true);
         let linkField = this.fieldLink;
         if (!linkField) {
            // Builder Notification already published in this.fieldLink
            var missingFieldLink = new Error(
               `Error: ABFieldConnect.migrateCreate(): Unable to find linked field for object[${
                  this.object.label
               }]->field[${this.label}][${this.id}] : settings[${JSON.stringify(
                  this.settings,
                  null,
                  4,
               )}]`,
            );
            missingFieldLink.field = this.toObj();
            reject(missingFieldLink);
            return;
         }
         // TODO : should check duplicate column
         let linkColumnName = this.fieldLink.columnName;

         // pull FK
         let linkFK = linkObject.PK();
         let indexField = this.indexField;
         if (indexField) {
            linkFK = indexField.columnName;
         }
         let indexType = "";
         let indexType2 = "";

         let didExist = false;
         // {bool}
         // Temp attempt to debug a certain case where we are trying to
         // create an existing field.

         // 1:M - create a column in the table and references to id of the link table
         if (
            this.settings.linkType == "one" &&
            this.settings.linkViaType == "many"
         ) {
            async.waterfall(
               [
                  // check column already exist
                  (next) => {
                     req.retry(() =>
                        knex.schema.hasColumn(tableName, this.columnName),
                     )
                        .then((exists) => {
                           didExist = exists;
                           if (exists) {
                              req.log(
                                 `   ... exists O[${this.object.name}].f[${this.columnName}] -> skip create attempt.`,
                              );
                           }
                           next(null, exists);
                        })
                        .catch(next);
                  },
                  // get MySQL column type of index field
                  (exists, next) => {
                     if (exists || !indexField) return next(null, exists);

                     this.getIndexColumnType(
                        knex,
                        indexField.object.tableName,
                        indexField.columnName,
                     )
                        .then((result) => {
                           indexType = result;
                           next(null, exists);
                        })
                        .catch(next);
                  },
                  // create a column
                  (exists, next) => {
                     if (exists) return next();
                     req.log(
                        `   ... creating O[${this.object.name}].f[${this.columnName}]`,
                     );
                     req.retry(() =>
                        knex.schema.table(tableName, (t) => {
                           let linkCol = this.setNewColumnSchema(
                              t,
                              this.columnName,
                              indexType,
                              linkFK,
                           );

                           // NOTE: federated table does not support reference column
                           if (
                              !linkObject.isExternal &&
                              this.object.connName == linkObject.connName
                           ) {
                              linkCol
                                 .references(linkFK)
                                 .inTable(linkTableName)
                                 .onDelete("SET NULL")
                                 .withKeyName(
                                    this.getConstraintName(
                                       this.object.name,
                                       this.columnName,
                                    ),
                                 );
                           } else {
                              req.log(
                                 `[1:M] object[${this.object.label}]->Field[${this.label}][${this.id}] skipping reference column creation: !linkObject.isExternal[${linkObject.isExternal}] && this.connName[${this.connName}] == linkObject.connName[${linkObject.connName}]`,
                              );
                           }
                        }),
                     )
                        .then(() => {
                           next();
                        })
                        .catch(next);
                  },
               ],
               (err) => {
                  if (err) {
                     // if we already had that
                     if (err.code === "ER_DUP_FIELDNAME") {
                        resolve();
                        return;
                     }
                     this.AB.notify.developer(err, {
                        context: "ABFieldConnect.migrateCreate()",
                        field: this,
                        tableName,
                        columnName: this.columnName,
                        // AB: this.AB,
                     });
                     reject(err);
                  } else resolve();
               },
            );
         }

         // 1:1 - create a column in the table, references to id of the link table and set to be unique
         if (
            this.settings.linkType == "one" &&
            this.settings.linkViaType == "one" &&
            this.settings.isSource
         ) {
            async.waterfall(
               [
                  // check column already exist
                  (next) => {
                     req.retry(() =>
                        knex.schema.hasColumn(tableName, this.columnName),
                     )
                        .then((exists) => {
                           next(null, exists);
                        })
                        .catch(next);
                  },
                  // get MySQL column type of index field
                  (exists, next) => {
                     if (exists || !indexField) return next(null, exists);

                     this.getIndexColumnType(
                        knex,
                        indexField.object.tableName,
                        indexField.columnName,
                     )
                        .then((result) => {
                           indexType = result;
                           next(null, exists);
                        })
                        .catch(next);
                  },
                  // create a column
                  (exists, next) => {
                     if (exists) return next();

                     req.retry(() =>
                        knex.schema.table(tableName, (t) => {
                           let linkCol = this.setNewColumnSchema(
                              t,
                              this.columnName,
                              indexType,
                              linkFK,
                           );

                           // NOTE: federated table does not support reference column
                           if (
                              !linkObject.isExternal &&
                              this.object.connName == linkObject.connName
                           ) {
                              linkCol
                                 .references(linkFK)
                                 .inTable(linkTableName)
                                 .onDelete("SET NULL")
                                 .withKeyName(
                                    this.getConstraintName(
                                       this.object.name,
                                       this.columnName,
                                    ),
                                 );
                           } else {
                              req.log(
                                 `[1:1] object[${this.object.label}]->Field[${this.label}][${this.id}] skipping reference column creation: !linkObject.isExternal[${linkObject.isExternal}] && this.connName[${this.connName}] == linkObject.connName[${linkObject.connName}]`,
                              );
                           }

                           // Set unique name to prevent ER_TOO_LONG_IDENT error
                           let uniqueName = `${this.object
                              .dbTableName(false)
                              .substring(0, 28)}_${this.columnName.substring(
                              0,
                              28,
                           )}_UNIQUE`;
                           t.unique(this.columnName, uniqueName);
                        }),
                     )
                        .then(() => {
                           next();
                        })
                        // .catch(next);
                        .catch((err) => {
                           if (err.code != "ER_DUP_FIELDNAME") {
                              console.error("[1:1]", err);
                           }
                           next(err);
                        });
                  },
               ],
               (err) => {
                  if (err) reject(err);
                  else resolve();
               },
            );
         }

         // M:1 - create a column in the link table and references to id of the target table
         else if (
            this.settings.linkType == "many" &&
            this.settings.linkViaType == "one"
         ) {
            async.waterfall(
               [
                  // check column already exist
                  (next) => {
                     // linkColumnName might be undefined.
                     // if so, then skip this process.
                     if (!linkColumnName) {
                        req.log(
                           "ABFieldConnect:migrateCreate(): could not resolve linkColumnName. This is unexpected.",
                           this.toObj(),
                        );
                        next(null, true);
                        return;
                     }

                     req.retry(() =>
                        linkKnex.schema.hasColumn(
                           linkTableName,
                           linkColumnName,
                        ),
                     )
                        .then((exists) => {
                           next(null, exists);
                        })
                        .catch(next);
                  },
                  // get MySQL column type of index field
                  (exists, next) => {
                     if (exists || !indexField) return next(null, exists);

                     this.getIndexColumnType(
                        knex,
                        indexField.object.tableName,
                        indexField.columnName,
                     )
                        .then((result) => {
                           indexType = result;
                           next(null, exists);
                        })
                        .catch(next);
                  },
                  // create a column
                  (exists, next) => {
                     if (exists) return next();

                     req.retry(() =>
                        linkKnex.schema.table(linkTableName, (t) => {
                           let linkCol = this.setNewColumnSchema(
                              t,
                              linkColumnName,
                              indexType,
                              linkFK,
                           );

                           // NOTE: federated table does not support reference column
                           if (
                              !this.object.isExternal &&
                              this.object.connName == linkObject.connName
                           ) {
                              linkCol
                                 .references(linkFK)
                                 .inTable(tableName)
                                 .onDelete("SET NULL")
                                 .withKeyName(
                                    this.getConstraintName(
                                       linkObject.name,
                                       linkColumnName,
                                    ),
                                 );
                           } else {
                              req.log(
                                 `[M:1] object[${this.object.label}]->Field[${this.label}][${this.id}] skipping linkCol creation: !isExternal[${this.object.isExternal}]  && connName[${this.connName}] == linkObj.connName[${linkObject.connName}]`,
                              );
                           }
                        }),
                     )
                        .then(() => {
                           next();
                        })
                        // .catch(next);
                        .catch((err) => {
                           if (err.code != "ER_DUP_FIELDNAME") {
                              req.log("[M:1]", err);
                           }
                           next(err);
                        });
                  },
               ],
               (err) => {
                  if (err) {
                     if (err.code == "ER_DUP_FIELDNAME") resolve();
                     else reject(err);
                  } else {
                     resolve();
                  }
               },
            );
         }

         // M:N - create a new table and references to id of target table and linked table
         else if (
            this.settings.linkType == "many" &&
            this.settings.linkViaType == "many"
         ) {
            var joinTableName = this.joinTableName(),
               getFkName = this.AB.rules.toJunctionTableFK;
            // [add] replaced this with a global rule, so we can reuse it in other
            // 		 places.
            /* 
						(objectName, columnName) => {

							var fkName = objectName + '_' + columnName;

							if (fkName.length > 64)
								fkName = fkName.substring(0, 64);

							return fkName;
						};
						*/

            var sourceKnex = this.settings.isSource ? knex : linkKnex;

            req.retry(() => sourceKnex.schema.hasTable(joinTableName)).then(
               (exists) => {
                  if (exists) {
                     resolve();
                     return;
                  }

                  // if it doesn't exist, then create it and any known fields:
                  return Promise.resolve()
                     .then(
                        () =>
                           new Promise((next, bad) => {
                              if (!indexField) return next();

                              this.getIndexColumnType(
                                 knex,
                                 indexField.object.tableName,
                                 indexField.columnName,
                              )
                                 .then((result) => {
                                    indexType = result;
                                    next();
                                 })
                                 .catch(bad);
                           }),
                     )
                     .then(
                        () =>
                           new Promise((next, bad) => {
                              let indexField2 = this.indexField2;
                              if (!indexField2) return next();

                              this.getIndexColumnType(
                                 knex,
                                 indexField2.object.tableName,
                                 indexField2.columnName,
                              )
                                 .then((result) => {
                                    indexType2 = result;
                                    next();
                                 })
                                 .catch(bad);
                           }),
                     )
                     .then(() =>
                        req.retry(() =>
                           sourceKnex.schema.createTable(joinTableName, (t) => {
                              t.increments("id").primary();
                              t.timestamps();
                              t.engine("InnoDB");
                              t.charset("utf8");
                              t.collate("utf8_unicode_ci");

                              var sourceFkName = getFkName(
                                 this.object.name,
                                 this.columnName,
                              );
                              var targetFkName = getFkName(
                                 linkObject.name,
                                 linkColumnName,
                              );

                              // create columns
                              let linkCol;
                              let linkCol2;

                              let linkFK2 = this.datasourceLink.PK();

                              // check for custom Index field
                              let indexField2 = this.indexField2;
                              if (indexField2) {
                                 // verify which Field this custom index relates to:
                                 // if my object then linkFK
                                 if (indexField2.object.id === this.object.id) {
                                    linkFK = indexField2.columnName;
                                 } else {
                                    // else linkFK2
                                    linkFK2 = indexField2.columnName;
                                 }
                              }

                              linkCol = this.setNewColumnSchema(
                                 t,
                                 this.object.name,
                                 indexType,
                                 linkFK,
                              );

                              linkCol2 = this.setNewColumnSchema(
                                 t,
                                 linkObject.name,
                                 indexType2,
                                 linkFK2,
                              );

                              // NOTE: federated table does not support reference column
                              if (
                                 !this.object.isExternal &&
                                 !linkObject.isExternal &&
                                 this.object.connName == linkObject.connName
                              ) {
                                 linkCol
                                    .references(linkFK)
                                    .inTable(tableName)
                                    .withKeyName(sourceFkName)
                                    .onDelete("SET NULL");

                                 linkCol2
                                    .references(linkFK2)
                                    .inTable(linkTableName)
                                    .withKeyName(targetFkName)
                                    .onDelete("SET NULL");
                              } else {
                                 req.log(
                                    `[M:N] object[${this.object.label}]->Field[${this.label}][${this.id}] skipping linkCol creation: !this.object.isExternal[${this.object.isExternal}] && !linkObject.isExternal[${linkObject.isExternal}] && connName[${this.connName}] == linkObj.connName[${linkObject.connName}]`,
                                 );
                              }

                              // // create columns
                              // t.integer(this.object.name).unsigned().nullable()
                              // 	.references(this.object.PK())
                              // 	.inTable(tableName)
                              // 	.withKeyName(sourceFkName)
                              // 	.onDelete('SET NULL');

                              // t.integer(linkObject.name).unsigned().nullable()
                              // 	.references(linkObject.PK())
                              // 	.inTable(linkTableName)
                              // 	.withKeyName(targetFkName)
                              // 	.onDelete('SET NULL');
                           }),
                        ),
                     )
                     .then(() => {
                        resolve();
                     })
                     .catch((err) => {
                        var ignoreCodes = [
                           "ER_DUP_FIELDNAME",
                           "ER_TABLE_EXISTS_ERROR",
                        ];
                        if (ignoreCodes.indexOf(err.code) == -1) {
                           req.log("[M:N]", err);
                        }

                        // If the table exists, skip the error
                        if (err.code == "ER_TABLE_EXISTS_ERROR") resolve();
                        else {
                           req.notify.developer(err, {
                              context: "ABFieldConnect.migrateCreate()",
                              field: this,
                              // AB: this.AB,
                           });
                           reject(err);
                        }
                     });
               },
            );
         } else {
            resolve();
         }
      });
   }

   /**
    * @function migrateDrop
    * perform the necessary sql actions to drop this column from the DB table.
    * @param {ABUtil.reqService} req
    *        the request object for the job driving the migrateCreate().
    * @param {knex} knex
    *        the Knex connection.
    * @return {Promise}
    */
   migrateDrop(req, knex) {
      knex = knex || this.AB.Knex.connection(this.object.connName);

      return new Promise((resolve, reject) => {
         // if field is imported, then it will not remove column in table
         if (this.object.isImported || this.isImported) return resolve();

         var tableName = this.object.dbTableName(true);

         // M:N
         if (
            this.settings.linkType == "many" &&
            this.settings.linkViaType == "many"
         ) {
            // If the linked object is removed, it can not find join table name.
            // The join table should be removed already.
            if (!this.datasourceLink)
               return super
                  .migrateDrop(req, knex)
                  .then(() => resolve(), reject);

            // drop join table
            var joinTableName = this.joinTableName();

            // get source knex of the join table
            var sourceKnex = knex;
            if (!this.settings.isSource) {
               sourceKnex = this.AB.Knex.connection(
                  this.datasourceLink.connName,
               );
            }

            sourceKnex.schema.dropTableIfExists(joinTableName).then(() => {
               super.migrateDrop(req, knex).then(() => resolve(), reject);
            });
         }
         // M:1,  1:M,  1:1
         else {
            let tasks = [];

            // Drop Unique
            tasks.push(
               knex.schema.table(tableName, (t) => {
                  t.dropUnique(this.columnName);
               }),
            );

            // Drop Index
            tasks.push(
               knex.schema.table(tableName, (t) => {
                  t.dropIndex(this.columnName);
               }),
            );

            // Drop Foreign key
            tasks.push(
               knex.schema.table(tableName, (t) => {
                  t.dropForeign(
                     this.columnName,
                     this.getConstraintName(this.object.name, this.columnName),
                  );
               }),
            );

            Promise.all(tasks)
               .then(() => {
                  // Drop column
                  super.migrateDrop(req, knex).then(() => resolve(), reject);
               })
               //	always pass, becuase ignore not found index errors.
               .catch((err) => {
                  // Drop column
                  super.migrateDrop(req, knex).then(() => resolve(), reject);
               });
         }
      });
   }

   ///
   /// DB Model Services
   ///

   /**
    * @method jsonSchemaProperties
    * register your current field's properties here:
    */
   jsonSchemaProperties(obj) {
      // take a look here:  http://json-schema.org/example1.html

      // if our field is not already defined:
      if (!obj[this.columnName]) {
         obj[this.columnName] = {
            anyOf: [
               { type: "array" },
               { type: "number" },
               { type: "null" },
               {
                  // allow empty string because it could not put empty array in REST api
                  type: "string",
                  // "maxLength": 0
               },
            ],
         };
      }
   }

   /**
    * @method requestParam
    * return the entry in the given input that relates to this field.
    * @param {obj} allParameters  a key=>value hash of the inputs to parse.
    * @return {obj} or undefined
    */
   requestParam(allParameters) {
      var myParameter = super.requestParam(allParameters);

      // pull id of relation value when 1:M and 1:1
      // to prevent REQUIRED column on insert data
      if (
         (this.settings.linkType == "one" &&
            this.settings.linkViaType == "many") || // 1:M
         (this.settings.linkType == "one" &&
            this.settings.linkViaType == "one" &&
            this.settings.isSource)
      ) {
         // 1:1 own table has the connected column

         myParameter = this.requestRelationParam(allParameters);
      }
      // remove relation column value
      // We need to update it in .requestRelationParam
      else if (myParameter) {
         delete myParameter[this.columnName];
      }

      return myParameter;
   }

   requestRelationParam(allParameters) {
      var myParameter = super.requestRelationParam(allParameters);
      if (!myParameter) return myParameter;

      if (myParameter[this.columnName]) {
         // let PK;

         // if value is array, then get id of array
         if (Array.isArray(myParameter[this.columnName])) {
            let result = [];

            myParameter[this.columnName].forEach((d) => {
               let val = this.getRelationValue(d, { forUpdate: true });

               // if (PK == "id") {
               //    val = parseInt(d[PK] || d.id || d);

               //    // validate INT value
               //    if (val && !isNaN(val)) result.push(val);
               // }
               // // uuid
               // else {
               result.push(val);
               // }
            });

            myParameter[this.columnName] = result;
         }
         // if value is a object
         else {
            myParameter[this.columnName] = this.getRelationValue(
               myParameter[this.columnName],
               { forUpdate: true },
            );

            // if (PK == "id") {
            //    myParameter[this.columnName] = parseInt(
            //       myParameter[this.columnName]
            //    );

            //    // validate INT value
            //    if (isNaN(myParameter[this.columnName]))
            //       myParameter[this.columnName] = null;
            // }
         }
      }

      if (!myParameter[this.columnName]) {
         // myParameter[this.columnName] = [];
         myParameter[this.columnName] = null;
      }
      // If this field is .linkType == one, then should not return an array
      else if (
         this.linkType?.() == "one" &&
         Array.isArray(myParameter[this.columnName])
      ) {
         myParameter[this.columnName] = myParameter[this.columnName][0] ?? null;
      }

      return myParameter;
   }

   /**
    * @method isValidParams
    * Parse through the given parameters and return an error if this field's
    * data seems invalid.
    * @param {obj} allParameters  a key=>value hash of the inputs to parse.
    * @return {array}
    */
   isValidData(allParameters) {
      var errors = [];

      return errors;
   }

   // relationName() {

   // 	var relationName = AppBuilder.rules.toFieldRelationFormat(this.columnName);

   // 	return relationName;
   // }

   joinTableName(prefixSchema = false) {
      var linkObject = this.datasourceLink;
      var tableName = "";

      if (this.object.isExternal && linkObject.isExternal) {
         var errorNoSails = new Error(
            "ABFieldConnect.joinTableName(): two ABObjectExternal are connected and current code wants to search sails.models for the connection info. That's a problem",
         );
         throw errorNoSails;

         var juntionModel = getJuntionInfo(
            this.object.tableName,
            this.datasourceLink.tableName,
         );

         tableName = juntionModel.tableName;
      } else {
         var sourceObjectName, targetObjectName, columnName;

         if (this.settings.isSource == true) {
            sourceObjectName = this.object.name;
            targetObjectName = linkObject.name;
            columnName = this.columnName;
         } else {
            sourceObjectName = linkObject.name;
            targetObjectName = this.object.name;
            // NOTE: it is possible for this.fieldLink to return undefined
            if (this.fieldLink) {
               columnName = this.fieldLink.columnName;
            }
         }

         // if columnName is not set, we can't proceed:
         if (!columnName) {
            var tryThisField = linkObject.fields(
               (f) => f.id == this.settings.linkColumn,
            )[0];
            if (tryThisField) {
               columnName = tryThisField.columnName;
            } else {
               // yeah, well this shouldn't be happening, and is only
               // happening due to the current Role & Scope transition,
               // so we will take this all out once we have those
               // merged into ABDefinitions
               columnName = "roles"; // linkObject.name;
            }
         }
         // return join table name
         tableName = this.AB.rules.toJunctionTableNameFormat(
            // this.object.application.name, // application name
            "JOINMN",
            sourceObjectName, // table name
            targetObjectName, // linked table name
            columnName,
         ); // column name
      }

      if (prefixSchema) {
         // pull database name
         var schemaName = "";
         if (this.settings.isSource == true)
            schemaName = this.object.dbSchemaName();
         else schemaName = linkObject.dbSchemaName();

         return "#schema#.#table#"
            .replace("#schema#", schemaName)
            .replace("#table#", tableName);
      } else {
         return tableName;
      }
   }

   /**
    * @method joinColumnNames
    *
    * @return {Object} - {
    * 		sourceColName {string},
    * 		targetColName {string}
    * }
    */
   joinColumnNames() {
      var sourceColumnName = "",
         targetColumnName = "";

      var objectLink = this.datasourceLink;

      if (this.object.isExternal && objectLink.isExternal) {
         var juntionModel = getJuntionInfo(
            this.object.tableName,
            this.datasourceLink.tableName,
         );

         sourceColumnName = juntionModel.sourceColumnName;
         targetColumnName = juntionModel.targetColumnName;
      } else {
         sourceColumnName = this.object.name;
         targetColumnName = this.datasourceLink.name;

         // if (this.settings.isSource == true) {
         // 	sourceColumnName = this.object.name;
         // 	targetColumnName = this.datasourceLink.name;
         // }
         // else {
         // 	sourceColumnName = this.datasourceLink.name;
         // 	targetColumnName = this.object.name;
         // }
      }

      return {
         sourceColumnName: sourceColumnName,
         targetColumnName: targetColumnName,
      };
   }

   getIndexColumnType(knex, tableName, columnName) {
      return new Promise((resolve, reject) => {
         knex.schema
            .raw(`SHOW COLUMNS FROM ${tableName} LIKE '${columnName}';`)
            .then((data) => {
               let indexType;
               let rows = data[0];
               if (rows[0]) {
                  indexType = rows[0].Type;
               }

               resolve(indexType);
            });
      });
   }

   setNewColumnSchema(t, columnName, columnType, linkFKname) {
      let result;

      // custom index - create column to match FK type
      if (columnType)
         result = t.specificType(columnName, columnType).nullable();
      // id
      else if (linkFKname == "id")
         result = t.integer(columnName).unsigned().nullable();
      // uuid
      else result = t.string(columnName).nullable();

      return result;
   }

   get joinTableSourceColumnName() {
      return `${this.joinTableName(true)}.${
         this.joinColumnNames().sourceColumnName
      }`;
   }

   get joinTableTargetColumnName() {
      return `${this.joinTableName(true)}.${
         this.joinColumnNames().targetColumnName
      }`;
   }
};
