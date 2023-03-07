const async = require("async");
const _ = require("lodash");
const path = require("path");
const ejs = require("ejs");
// prettier-ignore
const ABProcessTaskEmailCore = require(path.join(__dirname, "..", "..", "..", "core", "process", "tasks", "ABProcessTaskEmailCore.js"));
// prettier-ignore
const ABProcessParticipant = require(path.join(__dirname, "..", "ABProcessParticipant"));
// prettier-ignore
const ABProcessTaskServiceGetResetPasswordUrl = require(path.join(__dirname, "ABProcessTaskServiceGetResetPasswordUrl"));
// prettier-ignore
const ABProcessTaskServiceQuery = require(path.join(__dirname, "ABProcessTaskServiceQuery"));

module.exports = class ABProcessTaskEmail extends ABProcessTaskEmailCore {
   ////
   //// Process Instance Methods
   ////

   laneUserEmails(allLanes, req, instance) {
      if (!Array.isArray(allLanes)) {
         allLanes = [allLanes];
      }

      return new Promise((resolve, reject) => {
         const emails = [];
         const missingEmails = [];

         async.each(
            allLanes,
            (myLane, cb) => {
               myLane
                  .users(req,
                        this.objectOfStartElement,
                        this.startElements[0]?.myState(instance)?.data)
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
                  const text = `These Accounts have missing emails: ${missingEmails.join(
                     ", "
                  )}`;
                  const error = new Error(text);

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

   resolveAddresses(instance, field, method, select, custom, req) {
      return new Promise((resolve, reject) => {
         method = parseInt(method);

         const myLanes = [];

         // the logic for the users is handled in the
         // ABProcessParticipant object.  So let's create a new
         // object with our config values, and ask it for it's user
         const tempLane = new ABProcessParticipant(
            select,
            this.process,
            this.AB
         );

         const data = {};

         switch (method) {
            case 0:
               // select by current/next lane

               // if "to" field, we look for Next Lane
               if (field == "to") {
                  // get next tasks.
                  let tasks = this.nextTasks(instance);

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
                  const msg = `[${this.diagramID}].${field} == "${
                     field == "to" ? "Next" : "Current"
                  } Participant", but no lanes found.`;
                  const error = new Error(msg);
                  this.AB.notify.builder(error, { task: this });
                  reject(error);
                  return;
               }

               this.laneUserEmails(myLanes, req, instance)
                  .then((emails) => {
                     const data = {};
                     data[field] = emails;
                     this.stateUpdate(instance, data);
                     resolve();
                  })
                  .catch(reject);

               break;

            case 1:
               // specify a role/user account OR user-field

               // if we use fields, load the data from previous tasks
               let usedFields =
                  field == "to" ? this.toUsers?.fields : this.fromUsers?.fields;
               if (Array.isArray(usedFields) && usedFields?.length) {
                  // only get the fields we need for the email lookup
                  // get the values for the field
                  usedFields.forEach((f) => {
                     let foundValue = this.process.processData(this, [
                        instance,
                        f
                     ]);
                     if (foundValue) {
                        // We don't have a specific field lookup:
                        // Therefore I am setting the account equal to the
                        // value we just found

                        if (!Array.isArray(tempLane.account)) {
                           // make sure account is an array with viable data in it
                           tempLane.account = tempLane.account
                              ? [tempLane.account]
                              : [];
                        }

                        tempLane.account.push(foundValue);
                        tempLane.useAccount = 1;
                     }
                  });
               }

               // look them up
               this.laneUserEmails(tempLane, req, instance)
                  .then((emails) => {
                     const data = {};
                     data[field] = emails;
                     this.stateUpdate(instance, data);
                     resolve();
                  })
                  .catch(reject);
               break;

            case 2:
               // manually enter email(s)

               data[field] = custom.split(",");
               this.stateUpdate(instance, data);
               resolve();
               break;
         }
      });
   }

   resolveToAddresses(instance, req) {
      return this.resolveAddresses(
         instance,
         "to",
         this.to,
         this.toUsers,
         this.toCustom,
         req
      );
   }

   resolveFromAddresses(instance, req) {
      return this.resolveAddresses(
         instance,
         "from",
         this.from,
         this.fromUsers,
         this.fromCustom,
         req
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
         const tasks = [];

         tasks.push(this.resolveToAddresses(instance, req));
         tasks.push(this.resolveFromAddresses(instance, req));

         Promise.all(tasks)
            .then(() => {
               const myState = this.myState(instance);
               if (!Array.isArray(myState.to)) {
                  myState.to = [myState.to];
               }
               if (Array.isArray(myState.from)) {
                  myState.from = myState.from.shift();
               }
               const jobData = {
                  email: {
                     to: myState.to,
                     //    .to  {array}|{CSV list} of email addresses

                     from: myState.from,
                     //    .from {string} the From Email

                     subject: myState.subject,
                     //    .subject {string} The subject text of the email

                     html: this.processMessageText(instance, myState.message)
                     //    .text {string|Buffer|Stream|attachment-like obj} plaintext version of the message
                     //    .html {string|Buffer|Stream|attachment-like obj} HTML version of the email.
                  }
               };

               req.serviceRequest("notification_email.email", jobData, (
                  err /*, results */
               ) => {
                  if (err) {
                     let error = null;

                        // if ECONNREFUSED
                        const eStr = err.toString();
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
                  }
               );
            })
            .catch((error) => {
               this.log(instance, "Error processing Email Task");
               this.onError(instance, error);
               reject(error);
            });
      });
   }

   processMessageText(instance, message) {
      const previousElement = this.process
         .elements()
         .filter(
            (e) =>
               e instanceof ABProcessTaskServiceGetResetPasswordUrl ||
               e instanceof ABProcessTaskServiceQuery
         );
      const previousProcessData = {};

      for (let i = 0; i < previousElement.length; i++) {
         const key = previousElement[i].name.replaceAll(" ", "_");
         const state = previousElement[i].myState(instance);

         if (state.status === "completed") previousProcessData[key] = state;
      }

      return ejs.render(message, previousProcessData, {
         openDelimiter: "{",
         closeDelimiter: "}",
      });
   }
};

