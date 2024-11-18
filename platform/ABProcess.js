// import ABApplication from "./ABApplication"
// const ABApplication = require("./ABApplication"); // NOTE: change to require()
const ABProcessCore = require("../core/ABProcessCore.js");

const ABProcessEngine = require("./process/ABProcessEngine");

const async = require("async");
const hash = require("object-hash");
const convert = require("xml-js");

module.exports = class ABProcess extends ABProcessCore {
   constructor(attributes, AB) {
      super(attributes, AB);

      // listen
   }

   ///
   /// Static Methods
   ///
   /// Available to the Class level object.  These methods are not dependent
   /// on the instance values of the Application.
   ///

   /**
    * context()
    * Return an initial context data structure for use with a running
    * instance.
    * @param {obj} data the initial data passed into the process
    * @return {Promise}
    */
   context(data) {
      return {
         input: data,
         taskState: {},
      };
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
      if (!this.isSystemObject || data.settings.includeSystemObjects) {
         // make sure we don't get into an infinite loop:
         if (data.ids.indexOf(this.id) > -1) return;

         data.ids.push(this.id);

         // store our elements:
         this.elements().forEach((e) => {
            e.exportData(data);
         });
      }
   }

   /**
    * @method exportIDs()
    * export any relevant .ids for the necessary operation of this application.
    * @param {array} ids
    *        the array of ids to store our relevant .ids into.
    */
   exportIDs(ids) {
      // make sure we don't get into an infinite loop:
      if (ids.indexOf(this.id) > -1) return;

      ids.push(this.id);

      // store our elements:
      this.elements().forEach((e) => {
         e.exportIDs(ids);
      });
   }

   /**
    * instanceClose()
    * Mark the current instance as having been completed.
    * @param {obj} instance the instance we are working with.
    * @return {Promise}
    */
   instanceClose(instance) {
      instance.status = "completed";
      return this.instanceUpdate(instance);
   }

   /**
    * Save a copy of the definitions in the DB. If the definition already exists
    * find the uuid
    * @returns {Object} the ProcessDefinition
    */
   async instanceDefinition(req) {
      try {
         const definition = convert.xml2js(this.xmlDefinition, {
            compact: true,
         });
         const defHash = hash(definition);
         const processDefModel = this.AB.objectProcessDefinition().model();
         let [defRecord] = await processDefModel.find({ hash: defHash }, req);
         if (!defRecord) {
            defRecord = await processDefModel.create({
               hash: defHash,
               definition,
            });
         }
         return defRecord;
      } catch (error) {
         // strange edge case: numerous parallel calls can result in attempts
         // to create the same entry >1 time.  If that is the case, these are
         // those who weren't the first, so lets return this attempt again:
         if (error.toString().indexOf("ER_DUP_ENTRY") > -1) {
            return await this.instanceDefinition(req);
         }

         this.AB.notify.developer(error, {
            context: "ABProcess.instanceDefinition",
            process: this.toObj(),
         });
         throw error;
      }
   }

   /**
    * instanceError()
    * Mark the current instance as having an error.
    * @param {obj} instance the instance we are working with.
    * @param {ABProcessTask} task the task with the error
    * @return {Promise}
    */
   instanceError(instance, task, error) {
      instance.status = "error";
      if (task) {
         instance.errorTasks = instance.errorTasks || {};
         instance.errorTasks[task.diagramID] = error.toString();
      }
      return this.instanceUpdate(instance);
   }

   /**
    * instanceNew()
    * create a new running Instance of a process.
    * @param {obj} data
    *        the context data to send to the process.
    * @param {ABObject} object
    *        the object of the context data.
    * @param {Knex.Transaction} dbTransaction
    * @param {abutil.reqService} req
    *        the current request object for the api call.
    * @param {string} instanceKey? unique key that can be provided to prevent
    * duplicate processes from being added.
    * @return {Promise}
    */
   async instanceNew(
      data,
      object,
      dbTransaction,
      req,
      instanceKey,
      options = {},
   ) {
      var context = data;

      this.elements().forEach((t) => {
         if (t.initState) {
            t.initState(context);
         }
      });

      // NOTE: minify the context to prevent [ER_NET_PACKET_TOO_LARGE] Got a packet bigger than 'max_allowed_packet' bytes error
      let savedContext = context;
      if (options?.pruneData && object && context.input) {
         savedContext = this.AB.clone(context);
         savedContext.input = (
            await object.model().populateMin([context.input], true)
         )[0];
      }

      const definition = await this.instanceDefinition(req);

      const newValues = {
         processID: this.id,
         definition: definition.uuid,
         // xmlDefinition: this.xmlDefinition,
         context: savedContext,
         status: "created",
         log: ["created"],
         jobID: req ? req.jobID : "??",
         triggeredBy: req ? req.username() : "??",
         instanceKey: instanceKey ?? "UUID()",
         // if no instance key provided generate a UUID with SQL so we have a unique string
      };

      if (options?.rowLogID) {
         newValues.context = newValues.context ?? {};
         newValues.context.rowLogID = options?.rowLogID;
      }

      // Do NOT pass the dbTransaction to the ProcessInstance.create()
      let newInstance;
      try {
         newInstance = await this.AB.objectProcessInstance()
            .model()
            .create(newValues, null, req.userDefaults(), req);
         // Attach the full definitions to the newInstance
         newInstance.jsonDefinition = definition;
      } catch (error) {
         // This case is handled in ABProcessTrigger
         if (error.nativeError?.code != "ER_DUP_ENTRY") {
            this.AB.notify.developer(error, {
               process: this.toObj(),
               newValues,
               req,
            });
         }
         throw error;
      }

      return this.run(newInstance, dbTransaction, req);
   }

   /**
    * instanceReset()
    * Reset the given instance.
    * @param {obj} instance the instance we are working with.
    * @param {string} taskID the diagramID of the task we are resetting
    * @param {ABUtil.reqService} req
    *        an instance of the current request object for performing tenant
    *        based operations.
    * @return {Promise}
    */
   instanceReset(instance, taskID, req) {
      instance.status = "running";
      var task = this.elementForDiagramID(taskID);
      if (task) {
         task.reset(instance);
      }

      return this.run(instance, null, req);
   }

   /**
    * instanceUpdate()
    * Save the current instance.
    * @param {obj} instance the instance we are working with.
    * @return {Promise}
    */
   instanceUpdate(instance) {
      return this.AB.objectProcessInstance()
         .model()
         .update(instance.id, instance)
         .then((data) => {
            // console.log("after Update: ", data);
            return data;
         });
   }

   /**
    * run()
    * Step through the current process instance and have any pending tasks
    * perform their actions.
    * @param {obj} instance the instance we are working with.
    * @param {Knex.Transaction} dbTransaction
    * @param {ABUtil.reqService} req
    *        an instance of the current request object for performing tenant
    *        based operations.
    * @return {Promise}
    */
   async run(instance, dbTransaction, req) {
      // make sure the current instance is runnable:
      if (instance.status != "error" && instance.status != "completed") {
         // look up the full definition
         if (!instance.jsonDefinition && instance.definition) {
            try {
               instance.jsonDefinition = await this.AB.objectProcessDefinition()
                  .model()
                  .find({ uuid: instance.definition }, req)[0];
            } catch (err) {
               this.AB.notify.developer(err, {
                  context: "Error getting instance definition (ABProcess.run)",
                  process: this.toObj(),
                  instance,
                  req,
               });
            }
         }
         var Engine = new ABProcessEngine(instance, this);
         // Engine.pendingTasks().then((listOfPendingTasks) => {
         // });

         return Promise.resolve()
            .then(() => Engine.pendingTasks())
            .then((listOfPendingTasks) => {
               // if we have no more pending tasks, then we are done.
               if (listOfPendingTasks.length == 0) {
                  return this.instanceClose(instance);
               }

               // else give each task a chance to do it's thing
               return new Promise((next, bad) => {
                  async.map(
                     listOfPendingTasks,
                     (task, cb) => {
                        task
                           .do(instance, dbTransaction, req)
                           .then((isDone) => {
                              // if the task returns it is done,
                              // pass that along

                              if (isDone) {
                                 // make sure the next tasks know they are
                                 // ready to run (again if necessary)
                                 var nextTasks = task.nextTasks(instance);
                                 if (nextTasks) {
                                    nextTasks
                                       .filter((t) => t)
                                       .forEach((t) => {
                                          t.reset(instance);
                                       });
                                    cb(null, isDone);
                                 } else {
                                    // display error message
                                    task.onError(
                                       instance,
                                       new Error("error parsing next task"),
                                    );

                                    // WORKAROUND: `SITE_PROCESS_INSTANCE` table has a lot of "Did not find any outgoing flows for dID" error row data in production site.
                                    cb();
                                 }

                                 // else {
                                 //    // if null was returned then an error
                                 //    // happened during the .nextTask() fn
                                 //    var error = new Error(
                                 //       "error parsing next task"
                                 //    );
                                 //    this.instanceError(
                                 //       instance,
                                 //       task,
                                 //       error
                                 //    ).then(() => {
                                 //       cb();
                                 //    });
                                 // }
                              } else {
                                 cb(null, false);
                              }
                           })
                           .catch((err) => {
                              task.onError(instance, err);

                              // WORKAROUND: `SITE_PROCESS_INSTANCE` table has a lot of "Error: no valid path found" error row data in production site. (MILLION rows !!)
                              // skip ABProcessGatewayExclusive [no valid path found] to insert to DB
                              if (err?.message == "no valid path found") {
                                 cb();
                              } else {
                                 this.instanceError(instance, task, err).then(
                                    () => {
                                       cb();
                                    },
                                 );
                              }
                           });
                     },
                     (err, results) => {
                        // if at least 1 task has reported back it is done
                        // we try to run this again and process another task.
                        var hasProgress = false;
                        if (results) {
                           results.forEach((res) => {
                              if (res) hasProgress = true;
                           });
                        }
                        if (hasProgress) {
                           // repeat this process allowing new tasks to .do()
                           this.run(instance, dbTransaction, req)
                              .then(() => next())
                              .catch(bad);
                        } else {
                           // update instance (and end .run())
                           this.instanceUpdate(instance)
                              .then(() => next())
                              .catch(bad);
                        }
                     },
                  );
               });
            });
      } else {
         return Promise.resolve();
      }
   }

   /**
    * @method save()
    *
    * persist this instance of ABObject with it's parent ABApplication
    *
    *
    * @return {Promise}
    *						.resolve( {this} )
    */
   save() {
      // if this is an update:
      // if (this.id) {
      // 	return ABDefinition.update(this.id, this.toDefinition());
      // } else {

      // 	return ABDefinition.create(this.toDefinition());
      // }

      return this.toDefinition()
         .save()
         .then((data) => {
            // if I didn't have an .id then this was a create()
            // and I need to update my data with the generated .id

            if (!this.id) {
               this.id = data.id;
            }
         });
   }

   isValid() {
      var isValid =
         this.AB.processes((o) => {
            return o.name.toLowerCase() == this.name.toLowerCase();
         }).length == 0;
      return isValid;
   }
};
