const async = require("async");
const _ = require("lodash");
const path = require("path");
// prettier-ignore
const ABProcessTaskEmailCore = require(path.join(__dirname, "..", "..", "..", "core", "process", "tasks", "ABProcessTaskEmailCore.js"));
// prettier-ignore
const ABProcessParticipant = require(path.join(__dirname, "..", "ABProcessParticipant"));

// const AB = require("ab-utils");
// const reqAB = AB.reqApi({}, {});
// reqAB.jobID = "ABProcessTaskEmail";
// // reqAB {ABUtils.request}
// // a micro service request object used to send requests to other services.
// // This one is used to initiate emails to our notification_email service.

module.exports = class ABProcessTaskEmail extends ABProcessTaskEmailCore {
   ////
   //// Process Instance Methods
   ////

   laneUserEmails(allLanes) {
      if (!Array.isArray(allLanes)) {
         allLanes = [allLanes];
      }

      return new Promise((resolve, reject) => {
         var emails = [];
         var missingEmails = [];
         async.each(
            allLanes,
            (myLane, cb) => {
               myLane
                  .users()
                  .then((list) => {
                     list.forEach((l) => {
                        if (l.email) {
                           emails.push(l.email);
                        } else {
                           missingEmails.push(l.username);
                        }
                     });
                     cb();
                  })
                  .catch(cb);
            },
            (err) => {
               if (err) {
                  reject(err);
                  return;
               }
               if (missingEmails.length > 0) {
                  var text = "These Accounts have missing emails: ";
                  text += missingEmails.join(", ");
                  var error = new Error(text);
                  error.accounts = missingEmails;
                  this.AB.notify.builder(error, { task: this });
                  reject(error);
               } else {
                  resolve(_.uniq(emails));
               }
            }
         );
      });
   }

   resolveAddresses(instance, field, method, select, custom) {
      return new Promise((resolve, reject) => {
         method = parseInt(method);

         switch (method) {
            case 0:
               // select by current/next lane

               var myLanes = [];

               // if "to" field, we look for Next Lane
               if (field == "to") {
                  // get next tasks.
                  var tasks = this.nextTasks(instance);

                  // find any tasks that are NOT in my current Lane
                  tasks = tasks.filter((t) => {
                     return t.laneDiagramID != this.laneDiagramID;
                  });

                  // HOWEVER, if NONE of my next tasks are in another lane,
                  // then go back to my original set of tasks, and use my SAME
                  // Lane ...
                  if (tasks.length == 0) {
                     tasks = this.nextTasks(instance);
                  }

                  // get the lanes associated with these tasks
                  tasks.forEach((t) => {
                     myLanes.push(
                        this.process.elementForDiagramID(t.laneDiagramID)
                     );
                  });
               } else {
                  // else "from" field: get current lane
                  myLanes.push(this.myLane());
               }

               if (myLanes.length == 0) {
                  var msg = `[${this.diagramID}].${field} == "${
                     field == "to" ? "Next" : "Current"
                  } Participant", but no lanes found.`;
                  var error = new Error(msg);
                  this.AB.notify.builder(error, { task: this });
                  reject(error);
                  return;
               }

               this.laneUserEmails(myLanes)
                  .then((emails) => {
                     var data = {};
                     data[field] = emails;
                     this.stateUpdate(instance, data);
                     resolve();
                  })
                  .catch(reject);

               break;

            case 1:
               // specify a role/user account

               // the logic for the users is handled in the
               // ABProcessParticipant object.  So let's create a new
               // object with our config values, and ask it for it's user
               var tempLane = new ABProcessParticipant(
                  select,
                  this.process,
                  this.AB
               );
               this.laneUserEmails(tempLane)
                  .then((emails) => {
                     var data = {};
                     data[field] = emails;
                     this.stateUpdate(instance, data);
                     resolve();
                  })
                  .catch(reject);
               break;

            case 2:
               // manually enter email(s)
               var data = {};
               data[field] = custom.split(",");
               this.stateUpdate(instance, data);
               resolve();
               break;
         }
      });
   }

   resolveToAddresses(instance) {
      return this.resolveAddresses(
         instance,
         "to",
         this.to,
         this.toUsers,
         this.toCustom
      );
   }

   resolveFromAddresses(instance) {
      return this.resolveAddresses(
         instance,
         "from",
         this.from,
         this.fromUsers,
         this.fromCustom
      );
   }

   /**
    * do()
    * this method actually performs the action for this task.
    * @param {obj} instance  the instance data of the running process
    * @param {Knex.Transaction} dbTransaction
    * @param {ABUtil.reqService} req
    *        an instance of the current request object for performing tenant
    *        based operations.
    * @return {Promise}
    *      resolve(true/false) : true if the task is completed.
    *                            false if task is still waiting
    */
   do(instance, dbTransaction, req) {
      return new Promise((resolve, reject) => {
         var tasks = [];
         tasks.push(this.resolveToAddresses(instance));
         tasks.push(this.resolveFromAddresses(instance));

         Promise.all(tasks)
            .then(() => {
               var myState = this.myState(instance);
               if (!Array.isArray(myState.to)) {
                  myState.to = [myState.to];
               }
               if (Array.isArray(myState.from)) {
                  myState.from = myState.from.shift();
               }
               var jobData = {
                  email: {
                     to: myState.to,
                     //    .to  {array}|{CSV list} of email addresses

                     from: myState.from,
                     //    .from {string} the From Email

                     subject: myState.subject,
                     //    .subject {string} The subject text of the email

                     html: myState.message,
                     //    .text {string|Buffer|Stream|attachment-like obj} plaintext version of the message
                     //    .html {string|Buffer|Stream|attachment-like obj} HTML version of the email.
                  },
               };

               req.serviceRequest("notification_email.email", jobData, (
                  err /*, results */
               ) => {
                  if (err) {
                     var error = null;

                     // if ECONNREFUSED
                     var eStr = err.toString();
                     if (eStr.indexOf("ECONNREFUSED")) {
                        error = this.AB.toError(
                           "NotificationEmail: The server specified in config.local is refusing to connect.",
                           err
                        );
                        this.AB.notify.builder(error, { task: this });
                     }

                     // err objects are returned as simple {} not instances of {Error}
                     if (!error) {
                        error = this.AB.toError(
                           `NotificationEmail responded with an error (${
                              err.code || err.toString()
                           })`,
                           err
                        );
                        this.AB.notify.developer(error, { task: this });
                     }

                     reject(error);
                     return;
                  }

                  this.stateCompleted(instance);
                  this.log(instance, "Email Sent successfully");
                  resolve(true);
               });
            })
            .catch((error) => {
               console.error(error);
               reject(error);
            });
      });
   }
};
