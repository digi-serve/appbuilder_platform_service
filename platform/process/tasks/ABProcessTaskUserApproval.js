// import ABApplication from "./ABApplication"
// const ABApplication = require("./ABApplication"); // NOTE: change to require()

const path = require("path");
// prettier-ignore
const ABProcessTaskUserApprovalCore = require(path.join(__dirname, "..", "..", "..", "core", "process", "tasks", "ABProcessTaskUserApprovalCore.js"));

/**
 * @function parseEntryKeys()
 * Step through an array of formbuilder.io form entry descriptions
 * and identify which of our processData[keys] are being referenced
 * for their values.
 * @param {array} keys
 *        This is the array that will be UPDATED with the keys we
 *        find.
 * @param {array} entries
 *        The .formBuilder description of the fields being displayed
 *        on the form.
 */
function parseEntryKeys(keys, entries) {
   if (entries.length == 0) {
      return;
   }
   let entry = entries.shift();
   // entries that have abFieldID are the ones that directly reference
   // our data:
   if (entry.abFieldID) {
      if (entry.key) {
         keys.push(entry.key);
      }
   }

   // if this entry is a container, we need to parse it's children
   if (entry.components) {
      if (entry.path) {
         // keep the path
         keys.push(entry.path);
      }

      parseEntryKeys(keys, entry.components);
   }

   // recurse until we are done:
   parseEntryKeys(keys, entries);
}

/**
 * @function parseEntryArrays()
 * Step through an array of formbuilder.io form entry descriptions
 * and identify which them are containers for Arrays of information.
 * Once we find them we will then try to reduce our .processData[key]
 * to only have the essential fields that are referenced.
 * @param {array} entries
 *        The .formBuilder description of the fields being displayed
 *        on the form.
 * @param {json} data
 *        The processData that we need to pair down.
 */
function parseEntryArrays(entries, data) {
   if (entries.length == 0) {
      return;
   }

   let entry = entries.shift();

   if (
      entry.path &&
      entry.templates /* && entry.customClass == "customList" */
   ) {
      // if entry.path refers to one of our entries:
      let dataSet = data[entry.path];
      if (dataSet && dataSet.length) {
         let fieldsToKeep = parseEntryArrayFields(entry);

         for (let i = 0; i < dataSet.length; i++) {
            let d = dataSet[i];
            Object.keys(d).forEach((k) => {
               if (fieldsToKeep.indexOf(k) == -1) {
                  delete d[k];
               }
            });
         }
      }
   } else {
      if (entry.components) {
         // this is a layout component, so scan it's children
         parseEntryArrays(entry.components, data);
      }
   }

   // do the next one
   parseEntryArrays(entries, data);
}

/**
 * @function parseEntryArrayFields()
 * Step through the current formBuilder.io definition and find which
 * fields are referenced in it's description.
 * @param {array} entries
 *        The .formBuilder description of the fields being displayed
 *        on the form.
 * @param {json} data
 *        The processData that we need to pair down.
 */
function parseEntryArrayFields(entry) {
   let fieldHash = {};
   try {
      let allMatches = [
         ...JSON.stringify(entry).matchAll(/row\['([a-zA-Z_.0-9 ]+)'\]/g),
      ];
      (allMatches || []).forEach((match) => {
         fieldHash[match[1]] = match;
      });
   } catch (e) {
      console.error(e);
   }
   return Object.keys(fieldHash);
}

module.exports = class ABProcessTaskUserApproval extends (
   ABProcessTaskUserApprovalCore
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
         var myState = this.myState(instance);
         // if we haven't created a form entry yet, then do that:
         if (!myState.userFormID) {
            this._requestNewForm(instance).then(resolve).catch(reject);
         } else {
            // check the status of our user form:
            this._requestFormStatus(instance).then(resolve).catch(reject);
         }
      });
   }

   async _requestNewForm(instance) {
      var jobData = {
         name: this.name,
         process: instance.id,
         definition: this.process.id,
         ui: this.formBuilder,
      };

      /// getting ER_NET_PACKET_TOO_LARGE errors when creating userform
      /// Instead of just saving all the ProcessDataFields()
      /// look at formBuilder to see how we can decode the
      /// components and what values specifically we need to save.

      var processData = {};
      var listDataFields = this.process.processDataFields(this);
      listDataFields.forEach((entry) => {
         processData[entry.key] = this.process.processData(this, [
            instance,
            entry.key,
         ]);

         if (entry.field?.key == "connectObject") {
            processData[`${entry.key}.format`] = this.process.processData(
               this,
               [instance, `${entry.key}.format`],
            );
         }

         // make sure our user fields are not fully populated.  Just base user
         // is fine.
         if (entry.field?.key == "user") {
            let foundUser = processData[entry.key];
            if (foundUser) {
               let baseUser = {};
               let skipFields = ["salt", "password"];
               let relFields = Object.keys(foundUser).filter(
                  (f) => f.indexOf("__relation") > -1,
               );
               relFields.forEach((rf) => {
                  let pairedField = rf.replaceAll("__relation", "");
                  skipFields.push(rf);
                  skipFields.push(pairedField);
               });

               Object.keys(foundUser).forEach((f) => {
                  if (skipFields.indexOf(f) == -1) {
                     baseUser[f] = foundUser[f];
                  }
               });
               processData[entry.key] = baseUser;
            }
         }
      });

      // reduce the amount of data we are storing to only the ones referenced
      // by the formBuilder information:

      // 1) only keep keys that are used in the form:
      let keysToKeep = [];
      let copyComponents = this.AB.cloneDeep(this.formBuilder.components);
      parseEntryKeys(keysToKeep, copyComponents);
      Object.keys(processData).forEach((k) => {
         if (keysToKeep.indexOf(k) == -1) {
            delete processData[k];
         }
      });

      // 2) reduce the arrays of data to be minimal according to what
      //    we actually reference
      copyComponents = this.AB.cloneDeep(this.formBuilder.components);
      parseEntryArrays(copyComponents, processData);

      jobData.data = processData;

      if (parseInt(this.who) == 1) {
         if (parseInt(this.toUsers.useRole) == 1) {
            jobData.roles = this.toUsers.role;
         }

         if (parseInt(this.toUsers.useAccount) == 1) {
            jobData.users = this.toUsers.account;
         }

         // pull user data from the user fields
         if (parseInt(this.toUsers.useField) == 1) {
            const usedFields = this.toUsers.userFields ?? [];

            jobData.users = jobData.users || [];

            // Copy the array because I don't want to mess up this.toUsers.account
            jobData.users = jobData.users.slice(0, jobData.users.length);

            if (Array.isArray(usedFields) && usedFields?.length) {
               usedFields.forEach((f) => {
                  let foundUser = this.process.processData(this, [instance, f]);
                  if (foundUser) {
                     if (!Array.isArray(foundUser)) foundUser = [foundUser];

                     jobData.users = jobData.users.concat(
                        foundUser.map((u) => u.uuid || u.id || u.username || u),
                     );
                  }
               });
            }

            // Combine user list
            let allUserFields = [];
            (this.toUsers.fields || []).forEach((pKey) => {
               let userData = jobData.data[pKey] || [];
               if (userData && !Array.isArray(userData)) userData = [userData];

               allUserFields = allUserFields.concat(
                  userData
                     .filter((u) => u)
                     .map((u) => u.uuid || u.id || u.username || u),
               );
            });
            allUserFields = allUserFields.filter((uId) => uId);

            const listUsers = await this.AB.objectUser()
               .model()
               .find({
                  or: [{ uuid: allUserFields }, { username: allUserFields }],
               });

            // Remove empty items
            jobData.users = jobData.users.concat(listUsers.map((u) => u.uuid));
         }
      } else {
         // get roles & users from Lane

         var myLane = this.myLane();
         if (!myLane) {
            return this.errorConfig(
               instance,
               `no lane found for id:[${this.laneDiagramID}]`,
               "laneDiagramID",
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

      // Remove duplicate items
      jobData.users = this.AB.uniq(
         jobData.users,
         false,
         (u) => u.toString(), // support compare with different types
      );

      return new Promise((resolve, reject) => {
         this._req.serviceRequest(
            "process_manager.userform.create",
            jobData,
            (err, userForm) => {
               if (err) {
                  this.log(
                     instance,
                     "Error creating user form: " + err.toString(),
                  );
                  reject(err);
                  return;
               }
               this.log(instance, `created  user form [${userForm.uuid}]`);
               var data = { userFormID: userForm.uuid };
               this.stateUpdate(instance, data);
               resolve(false);
            },
         );
      });
   }

   _requestFormStatus(instance) {
      var myState = this.myState(instance);
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
                     "Error checking user form status: " + err.toString(),
                  );
                  reject(err);
                  return;
               }

               if (!userForm) {
                  var message = `unable to find userForm[${myState.userFormID}]!`;
                  var missingUserFormError = new Error(message);
                  this.log(message);
                  reject(missingUserFormError);
                  return;
               }

               if (userForm.status && userForm.status != "pending") {
                  var data = {
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
            },
         );
      });
   }
};
