const SubProcessCore = require("../../../core/process/tasks/ABProcessTaskSubProcessCore");
const ABProcessTriggerCore = require("../../../core/process/tasks/ABProcessTriggerCore");
const ABProcessEngine = require("../ABProcessEngine");

module.exports = class SubProcess extends SubProcessCore {
   ////
   //// Process Instance Methods
   ////

   /**
    * @method do()
    * this method actually performs the action for this task.
    * @param {obj} instance  the instance data of the running process
    * @param {Knex.Transaction?} trx - [optional]
    *
    * @return {Promise}
    *      resolve(true/false) : true if the task is completed.
    *                            false if task is still waiting
    */
   async do(instance, trx, req) {
      if (!this.isEnable || !this.parameterId) {
         this.stateCompleted(instance);
         return true;
      }

      // Pull the entry data to sub process
      let processData = this.process.processData(this, [
         instance,
         this.parameterId,
      ]);

      if (processData == null) {
         this.stateCompleted(instance);
         return true;
      }
      // Convert the entry data to an array
      else if (processData && !Array.isArray(processData)) {
         processData = [processData];
      }

      let dbTransaction = trx;

      // Get a new Context and apply it to each Tasks in sub process
      let context = this.process.context(processData);
      this.elements().forEach((t) => {
         if (t.initState) {
            t.initState(context);
         }
      });

      // Get a new ABProcessEngine for this Sub process
      let processEngine = new ABProcessEngine(instance, this);
      processEngine.startTask = () => {
         let firstConnection = this.connections()[0];
         if (firstConnection == null) return;

         let startElement = this.elementForDiagramID(firstConnection.from);
         if (startElement == null) {
            startElement = this.elementForDiagramID(firstConnection.to);
         }

         if (startElement instanceof ABProcessTriggerCore) {
            // No need to call .do function of the start trigger in sub process
            startElement.wantToDoSomething = () => false;
         }

         return startElement;
      };

      // Find BPMN definition of this Sub process
      // And set it into the new ABProcessEngine
      let bpmnProcess =
         instance.jsonDefinition.definition["bpmn2:definitions"][
            "bpmn2:process"
         ];
      let bpmnSubProcess;

      for (let key in bpmnProcess) {
         if (bpmnProcess[key] == null || bpmnSubProcess) continue;

         let bpmnAttrs = bpmnProcess[key];
         if (!Array.isArray(bpmnAttrs)) bpmnAttrs = [bpmnAttrs];

         bpmnAttrs.forEach((bpmnA) => {
            if (
               bpmnA["_attributes"] &&
               bpmnA["_attributes"].id == this.diagramID
            ) {
               bpmnSubProcess = bpmnA;
            }
         });
      }

      processEngine.setHashDiagramObjects(bpmnSubProcess);

      // Start looping to pass datas into Sub Process sequentially
      for (let data of processData) {
         var value = {};
         value.data = data;
         this.stateUpdate(instance, value);

         let taskElements = [];

         // Pull pending tasks
         let subTasks = await processEngine.pendingTasks();

         // Do tasks
         while (subTasks && subTasks.length > 0) {
            for (let t of subTasks) {
               let isDone = false;
               taskElements.push(t);

               try {
                  isDone = await t.do(instance, dbTransaction, req);
               } catch (error) {
                  t.onError(instance, error);
               }

               // NOTE: Prevent infinite looping when there is "Did not find my definition" error.
               // The reset code should be outside .catch statement
               // https://github.com/appdevdesigns/app_builder/blob/master/api/classes/platform/process/tasks/ABProcessTaskSubProcess.js#L152
               // (ProcessTask Error: SubProcess : Error: Configuration Error: Did not find my definition for dID[...])
               if (isDone) {
                  let nextTasks = t.nextTasks(instance);
                  if (nextTasks) {
                     // make sure the next tasks know they are
                     // ready to run (again if necessary)
                     nextTasks.forEach((nextT) => {
                        nextT.reset(instance);
                     });
                  }
               }
            }

            // Pull pending tasks again
            subTasks = await processEngine.pendingTasks();
         }

         // No pending tasks, then go to process the next data
         if (!subTasks || subTasks.length < 1) {
            // Reset state of tasks
            taskElements.forEach((t) => {
               t.reset(instance);
            });
            continue;
         }
      }

      this.stateCompleted(instance);
      return true;
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
      return this.process.exportData.call(this, data);
   }

   /**
    * @method exportIDs()
    * export any relevant .ids for the necessary operation of this application.
    * @param {array} ids
    *        the array of ids to store our relevant .ids into.
    */
   exportIDs(ids) {
      return this.process.exportIDs.call(this, ids);
   }
};
