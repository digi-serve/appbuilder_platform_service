const InsertRecordTaskCore = require("../../../core/process/tasks/ABProcessTaskServiceInsertRecordCore.js");
const ABProcessTaskServiceQuery = require("./ABProcessTaskServiceQuery.js");

module.exports = class InsertRecord extends InsertRecordTaskCore {
   ////
   //// Process Instance Methods
   ////

   /**
    * @method do()
    * this method actually performs the action for this task.
    * @param {obj} instance  the instance data of the running process
    * @param {Knex.Transaction?} trx - [optional]
    * @param {ABUtil.reqService} req
    *        an instance of the current request object for performing tenant
    *        based operations.
    * @return {Promise}
    *      resolve(true/false) : true if the task is completed.
    *                            false if task is still waiting
    */
   do(instance, trx, req) {
      this._req = req;
      this.object = this.AB.objectByID(this.objectID);
      if (!this.object) {
         return this.errorConfig(
            instance,
            "Could not find the object to insert record task",
            "objectID"
         );
      }

      let tasks = [];
      let pullDataTasks = [];
      let results = [];

      // Create tasks to pull data for repeat insert rows
      if (this.isRepeat) {
         let fieldRepeat = this.fieldRepeat;
         if (fieldRepeat) {
            let startData = this.processDataStart(instance);
            let repeatDatas = startData[fieldRepeat.relationName()] || [];
            if (repeatDatas && !Array.isArray(repeatDatas))
               repeatDatas = [repeatDatas];

            repeatDatas.forEach((rData) => {
               pullDataTasks.push(
                  () =>
                     new Promise((next, bad) => {
                        let PK = fieldRepeat.datasourceLink.PK();
                        this._req
                           .retry(() =>
                              fieldRepeat.datasourceLink.model().findAll(
                                 {
                                    where: {
                                       glue: "and",
                                       rules: [
                                          {
                                             key: PK,
                                             rule: "equals",
                                             value: rData[PK],
                                          },
                                       ],
                                    },
                                 },
                                 null,
                                 req
                              )
                           )
                           .then((result) => {
                              next(this.getDataValue(instance, result[0]));
                           })
                           .catch(bad);
                     })
               );
            });
         }
      }
      // Pull a data to insert
      else {
         pullDataTasks.push(() => Promise.resolve(this.getDataValue(instance)));
      }

      (pullDataTasks || []).forEach((pullTask) => {
         tasks.push(
            Promise.resolve()
               .then(() => pullTask())
               .then((val) =>
                  this._req.retry(() => this.object.model().create(val))
               )
               // NOTE: .create() returns the fully populated instance already.
               // .then((record) =>
               //    this.object.model().findAll({
               //       where: {
               //          glue: "and",
               //          rules: [
               //             {
               //                key: this.object.PK(),
               //                rule: "equals",
               //                value: record[this.object.PK()],
               //             },
               //          ],
               //       },
               //       populate: true,
               //    }, null, req)
               // )
               .then((result) => {
                  results.push(result);
                  return Promise.resolve();
               })
         );
      });

      return Promise.all(tasks)
         .then(() => {
            this.stateUpdate(instance, {
               data: results,
            });
            this.stateCompleted(instance);
            return true;
         })
         .catch((err) => {
            this.log(instance, "Error completing Insert Record");
            this.onError(instance, err);
            throw err;
         });
   }

   /**
    * @method processData()
    * return the current value requested for the given data key.
    * @param {obj} instance
    * @param {string} key  (optional)
    *        A reference for which data field we are wanting to return.
    *        The format is `{task.id}.{key}`  where data[key] will result
    *        in a stored value by this task.
    *        If key is not provided, then we return our whole data value.
    *        (see processDataPrevious() )
    * @return {mixed} | null
    */
   processData(instance, key) {
      if (key) {
         const parts = key.split(".");
         if (parts[0] != this.id) return null;
      }

      let myState = this.myState(instance) || {};
      let data = myState.data;
      if (data == null) return null;

      return key ? data[key] : data;
   }

   /**
    * @method processDataStart()
    * return the value of the start element.
    * @param {obj} instance
    * @return {mixed} | null
    */
   processDataStart(instance) {
      let startElement = this.startElement;
      if (!startElement) return null;

      return (startElement.myState(instance) || {}).data;
   }

   /**
    * @method processDataPrevious()
    * return the value of the previous Insert Record task.
    * @param {obj} instance
    * @return {mixed} | null
    */
   processDataPrevious(instance) {
      let prevElem = this.process.connectionPreviousTask(this)[0];
      if (!prevElem) return null;

      let result = null;

      if (
         prevElem instanceof InsertRecord ||
         prevElem instanceof ABProcessTaskServiceQuery
      ) {
         result = prevElem.processData(instance);
      }

      return result;
   }

   /**
    * @method getDataValue()
    * return the value to insert.
    * @param {obj} instance
    * @param {obj} rawData - when the insert record task has multi-instance maker
    *                        pass multi-raw data to this
    *                        https://github.com/appdevdesigns/planning/issues/109
    * @return {mixed} | null
    */
   getDataValue(instance, rawData) {
      let result = {};
      let startData = this.processDataStart(instance);
      let previousData = this.processDataPrevious(instance);

      let getFieldValue = (object, fieldId, sourceData) => {
         if (!object || !sourceData) return null;

         let columnName;

         // Pull value of link object relation
         // data[__relation][COLUMN_NAME]
         if (fieldId.indexOf("|") > -1) {
            let linkFieldIds = fieldId.split("|");
            let field = object.fields(
               (f) =>
                  f.id == linkFieldIds[0] ||
                  f.columnName == linkFieldIds[0] ||
                  (f.translations || []).filter(
                     (tran) => tran.label == linkFieldIds[0]
                  ).length
            )[0];
            if (!field) return null;

            let objectLink = field.datasourceLink;
            if (!objectLink) return null;

            if (linkFieldIds[1] == "PK") {
               columnName = objectLink.PK();
            } else {
               let fieldLink = objectLink.fields(
                  (f) =>
                     f.id == linkFieldIds[1] ||
                     f.columnName == linkFieldIds[1] ||
                     (f.translations || []).filter(
                        (tran) => tran.label == linkFieldIds[1]
                     ).length
               )[0];
               if (!fieldLink) return null;

               columnName = fieldLink.columnName;
            }

            let data = sourceData[field.relationName()];
            if (!data) return null;

            return data[columnName];
         }
         // Pull value of the object
         else {
            if (fieldId == "PK") {
               columnName = object.PK();
            } else {
               let field = object.fields(
                  (f) =>
                     f.id == fieldId ||
                     f.columnName == fieldId ||
                     (f.translations || []).filter(
                        (tran) => tran.label == fieldId
                     ).length
               )[0];
               if (!field) return null;

               columnName = field.columnName;
            }

            return sourceData[columnName];
         }
      };

      Object.keys(this.fieldValues || {}).forEach((fieldId) => {
         let field = this.object.fields((f) => f.id == fieldId)[0];
         if (!field) return;

         if (!this.fieldValues) return;

         let item = this.fieldValues[fieldId];
         switch (item.set) {
            case "1": // custom value
               result[field.columnName] = item.value;
               break;
            case "2": // update with root data
               result[field.columnName] = getFieldValue(
                  this.objectOfStartElement,
                  item.value,
                  startData
               );
               break;
            case "3": // update with previous data step
               result[field.columnName] = getFieldValue(
                  this.objectOfPrevElement,
                  item.value,
                  previousData
               );
               break;
            case "4": // formula value
               if (item.value) {
                  let formula = item.value || "";

                  // pull [PARAMETER NAME] names
                  let paramNames = formula.match(/\[(.*?)\]/g) || [];
                  paramNames.forEach((match) => {
                     let param = match.replace(/\[/g, "").replace(/\]/g, "");

                     let sourceName = param.split(".")[0];
                     let fieldName = param.split(".")[1];

                     // Pull data from the start trigger
                     // or a previous insert process task
                     if (
                        fieldName &&
                        (sourceName == "startData" ||
                           sourceName == "previousData")
                     ) {
                        // Pull an object
                        let sourceObj =
                           sourceName == "startData"
                              ? this.objectOfStartElement
                              : this.objectOfPrevElement;
                        if (!sourceObj) return;

                        // Pull a field
                        let sourceField = sourceObj.fields((f) => {
                           return (
                              f.id == fieldName ||
                              f.columnName == fieldName ||
                              (f.translations || []).filter(
                                 (tran) => tran.label == fieldName
                              ).length
                           );
                        })[0];
                        if (!sourceField) return;

                        // Get value from a field that calculates value on fly
                        if (sourceField.key == "calculate") {
                           formula = formula.replace(
                              match,
                              sourceName == "startData"
                                 ? sourceField.format(startData)
                                 : sourceField.format(previousData)
                           );
                        } else {
                           formula = formula.replace(
                              match,
                              sourceName == "startData"
                                 ? startData[fieldName]
                                 : previousData[fieldName]
                           );
                        }
                     }
                     // Pull data from the repeat data
                     else if (sourceName == "repeatData") {
                        let fieldRepeat = this.fieldRepeat;
                        if (fieldRepeat || fieldRepeat.datasourceLink) {
                           formula = formula.replace(
                              match,
                              getFieldValue(
                                 fieldRepeat.datasourceLink,
                                 fieldName,
                                 rawData
                              )
                           );
                        }
                     }
                     // Pull data from a saved parameter in the query task
                     else {
                        let processField = (
                           this.process.processDataFields(this) || []
                        ).filter(
                           (opt) =>
                              opt &&
                              (opt.key == param ||
                                 opt.value == param ||
                                 opt.label == param)
                        )[0];

                        if (processField) {
                           let processData = this.process.processData(this, [
                              instance,
                              processField.key,
                           ]);

                           if (Array.isArray(processData))
                              processData = processData.filter(
                                 (d) => d != null
                              );

                           formula = formula.replace(match, processData);
                        }
                     }
                  });

                  let evalValue;
                  try {
                     evalValue = eval(formula);
                  } catch (e) {
                     this.AB.notify.builder(e, {
                        context:
                           "ABProcessTaskServiceInsertRecord:getDataValue():Case 4:  Invalid formula",
                        formula,
                        match,
                     });
                     evalValue = `!!Error [${formula}] !!`;
                  }

                  if (
                     evalValue.toString &&
                     (field.key == "string" || field.key == "LongText")
                  ) {
                     evalValue = evalValue.toString();
                  }

                  result[field.columnName] = evalValue;
               }
               break;
            case "5": // pull data from multiple instances
               var fieldRepeat = this.fieldRepeat;
               if (!fieldRepeat || !fieldRepeat.datasourceLink) break;
               result[field.columnName] = getFieldValue(
                  fieldRepeat.datasourceLink,
                  item.value,
                  rawData
               );
               break;
            case "6":
               var paramKeys = (item.value || "").split(",");
               (paramKeys || []).forEach((key) => {
                  if (key == null) return;

                  let processData = this.process.processData(this, [
                     instance,
                     key,
                  ]);
                  if (processData == null) {
                     result[field.columnName] =
                        result[field.columnName] != null &&
                        result[field.columnName] != ""
                           ? result[field.columnName]
                           : null;
                     return;
                  }

                  // If .field is a connect field who has M:1 or M:N relations, then it will set value with an array
                  let isMultipleValue =
                     field.key == "connectObject" &&
                     field.settings &&
                     field.settings.linkType == "many";
                  if (isMultipleValue) {
                     result[field.columnName] = result[field.columnName] || [];

                     // Reformat processData to be M:1 connect data value
                     let data = [];
                     if (data == null) {
                        data = [];
                     } else if (Array.isArray(processData)) {
                        data = processData.filter((d) => d != null);
                     } else if (
                        typeof processData == "string" ||
                        typeof processData == "number"
                     ) {
                        data = {};
                        data["id"] = processData;
                        data["uuid"] = processData;
                     } else {
                        data = processData;
                     }

                     result[field.columnName] =
                        result[field.columnName].concat(data);
                  }
                  // If .field supports a single value, then it pull only the first value item.
                  else if (
                     result[field.columnName] == null ||
                     result[field.columnName] == ""
                  ) {
                     result[field.columnName] =
                        (Array.isArray(processData)
                           ? processData.filter((d) => d != null)[0]
                           : processData) || null;
                  }
               });
               break;
         }
      });

      return result;
   }
};
