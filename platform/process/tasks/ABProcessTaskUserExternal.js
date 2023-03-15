const ejs = require("ejs");
const path = require("path");
// prettier-ignore
const ABProcessTaskUserExternalCore = require(path.join(__dirname, "..", "..", "..", "core", "process", "tasks", "ABProcessTaskUserExternalCore.js"));

module.exports = class ABProcessTaskUserExternal extends (
   ABProcessTaskUserExternalCore
) {
   ////
   //// Process Instance Methods
   ////

   /**
    * do()
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
      return new Promise((resolve, reject) => {
         const myState = this.myState(instance);
         // if we haven't created a form entry yet, then do that:
         if (!myState.userFormID) {
            this._requestNewForm(instance).then(resolve).catch(reject);
         } else {
            // check the status of our user form:
            this._requestFormStatus(instance).then(resolve).catch(reject);
         }
      });
   }

   _requestNewForm(instance) {
      return new Promise((resolve, reject) => {
         var jobData = {
            name: this.name,
            process: instance.id,
            definition: this.process.id,
            ui: {},
         };
         const url = this.addProcessValueToUrl(instance, this.url);
         jobData.data = {
            url,
         };
         const toUsers = this.toUsers;

         if (parseInt(this.who) === 1) {
            if (parseInt(toUsers.useRole) === 1) {
               jobData.roles = toUsers.role;
            }

            if (parseInt(toUsers.useAccount) === 1) {
               jobData.users = toUsers.account;
            }

            const filterConditions = toUsers.filterConditions;

            if (filterConditions?.glue && filterConditions?.rules?.length)
               jobData.scopeQuery = filterConditions;
         } else {
            // get roles & users from Lane
            const myLane = this.myLane();

            if (!myLane) {
               return this.errorConfig(
                  instance,
                  `no lane found for id:[${this.laneDiagramID}]`,
                  "laneDiagramID"
               );
            }

            if (myLane.useRole) {
               jobData.roles = myLane.role;
            }

            if (myLane.useAccount) {
               jobData.users = myLane.account;
            }
         }

         // Validate Roles & Users parameters:
         if (jobData.roles && !Array.isArray(jobData.roles))
            jobData.roles = [jobData.roles];

         if (jobData.users && !Array.isArray(jobData.users))
            jobData.users = [jobData.users];

         this._req.serviceRequest(
            "process_manager.userform.create",
            jobData,
            (err, userForm) => {
               if (err) {
                  this.log(
                     instance,
                     "Error creating user form: " + err.toString()
                  );
                  reject(err);
                  return;
               }

               this.log(instance, `created  user form [${userForm.uuid}]`);

               const data = { userFormID: userForm.uuid };

               this.stateUpdate(instance, data);

               resolve(false);
            }
         );
      });
   }

   _requestFormStatus(instance) {
      const myState = this.myState(instance);
      return new Promise((resolve, reject) => {
         var jobData = {
            formID: myState.userFormID,
         };
         this._req.log(`checking status on user form [${myState.userFormID}]`);
         this._req.serviceRequest(
            "process_manager.userform.status",
            jobData,
            (err, userForm) => {
               if (err) {
                  this.log(
                     instance,
                     "Error checking user form status: " + err.toString()
                  );

                  reject(err);
                  return;
               }

               if (!userForm) {
                  const message = `unable to find userForm[${myState.userFormID}]!`;
                  const missingUserFormError = new Error(message);

                  this.log(message);

                  reject(missingUserFormError);
                  return;
               }

               if (userForm.status && userForm.status != "pending") {
                  const data = {
                     userFormResponse: userForm.response,
                     responder: userForm.responder,
                  };
                  this.stateUpdate(instance, data);
                  this.stateCompleted(instance);
                  resolve(true);
               } else {
                  // still pending:
                  resolve(false);
               }
            }
         );
      });
   }

   addProcessValueToUrl(instance, url) {
      const previousElements = this.process.elements();
      const processValues = {};

      previousElements.forEach((element) => {
         const key = element.name.replaceAll(" ", "_");
         const state = element.myState(instance);
         if (state.status === "completed") processValues[key] = state;
      });

      return ejs.render(url, processValues, {
         openDelimiter: "{",
         closeDelimiter: "}",
      });
   }

   /**
    * @method processData()
    * return the current value requested for the given data key.
    * @param {obj} instance
    * @return {mixed} | null
    */
   processData(instance, key) {
      const parts = (key || "").split(".");

      if (parts[0] != this.id) return null;

      const myState = this.myState(instance);

      return myState[parts[1]];
   }
};
