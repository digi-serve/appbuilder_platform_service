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
   async do(instance, trx) {
      if (!this.isEnable || !this.parameterId) {
         this.stateCompleted(instance);
         return Promise.resolve(true);
      }

      // Pull the entry data to sub process
      let processData = this.process.processData(this, [
         instance,
         this.parameterId
      ]);

      if (processData == null) {
         this.stateCompleted(instance);
         return Promise.resolve(true);
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

         let startElement = this.elementForDiagramID(
            firstConnection.from
         );
         if (startElement == null) {
            startElement = this.elementForDiagramID(
               firstConnection.to
            );
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
         instance.jsonDefinition["bpmn2:definitions"]["bpmn2:process"];
      let bpmnSubProcess;
      for (let key in bpmnProcess) {
         if (bpmnProcess[key]["_attributes"] == null || bpmnSubProcess)
            continue;

         // FOUND it here
         if (bpmnProcess[key]["_attributes"].id == this.diagramID) {
            bpmnSubProcess = bpmnProcess[key];
         }
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
               try {
                  let isDone = await t.do(instance, dbTransaction);
                  if (isDone) {
                     let nextTasks = t.nextTasks(
                        instance
                     );
                     if (nextTasks) {
                        // make sure the next tasks know they are
                        // ready to run (again if necessary)
                        nextTasks.forEach((nextT) => {
                           nextT.reset(instance);
                        });
                     }
                  }
               }
               catch(error) {
                  t.onError(instance, error);
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
      return Promise.resolve(true);
   }
};
