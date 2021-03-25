/**
 * ABProcessParticipant
 * manages the participant lanes in a Process Diagram.
 *
 * Participants manage users in the system (when there are no lanes defined)
 * and provide a way to lookup a SiteUser.
 */
const _ = require("lodash");
const ABProcessParticipantCore = require("../../core/process/ABProcessParticipantCore.js");

module.exports = class ABProcessParticipant extends ABProcessParticipantCore {
   // constructor(attributes, process, application) {
   //    super(attributes, process, application);
   // }

   ////
   //// Instance Methods
   ////

   /**
    * @method exportIDs()
    * export any relevant .ids for the necessary operation of this application.
    * @param {array} ids
    *        the array of ids to store our relevant .ids into
    */
   exportIDs(ids) {
      ids.push(this.id);
   }

   users() {
      return new Promise((resolve, reject) => {
         var allLookups = [];
         allLookups.push(this.usersForRoles());
         allLookups.push(this.usersForAccounts());

         Promise.all(allLookups)
            .then((results) => {
               var users = results[0].concat(results[1]);
               users = _.uniqBy(users, "uuid");
               resolve(users);
            })
            .catch(reject);
      });
   }

   usersForAccounts() {
      return new Promise((resolve, reject) => {
         if (!this.useAccount) {
            resolve([]);
            return;
         }
         if (!Array.isArray(this.account)) {
            this.account = [this.account];
         }

         this.AB.objectUser()
            .model()
            .find({ uuid: this.account })
            .then((listUsers) => {
               resolve(listUsers);
            })
            .catch(reject);
      });
   }

   usersForRoles() {
      return new Promise((resolve, reject) => {
         if (!this.useRole) {
            resolve([]);
            return;
         }

         // console.log(
         //    "TODO: ABProcessParticipant.usersForRoles():  after User Field revamp"
         // );
         // resolve([]);
         // return;

         if (!Array.isArray(this.role)) {
            this.role = [this.role];
         }

         // lookup the current list of Roles we are defined to use.
         this.AB.objectRole()
            .find(
               { where: { uuid: this.role }, populate: true },
               // {
               //    where: {
               //       glue: "and",
               //       rules: [
               //          {
               //             key: RoleModel.PK(),
               //             rule: "in",
               //             value: this.role,
               //          },
               //       ],
               //    },
               //    populate: true,
               // },
               {} // <-- user data isn't used in our condition
            )

            .then((result = []) => {
               // for each role, compile a list of Users->usernames
               var allUsers = [];
               (result || []).forEach((role) => {
                  var usernames = (role.users || []).map((u) => {
                     // the data entry is a ABFieldUser instance,
                     // so it is in the format:
                     // {
                     //    id: "username",
                     //    image:"",
                     //    text: "username"
                     // }
                     return u.username; // u.id || u;
                  });
                  allUsers = allUsers.concat(usernames);
               });

               // make sure we remove any duplicates
               allUsers = _.uniq(allUsers);

               // now return our SiteUsers based upon these usernames
               this.AB.objectUser()
                  .find(
                     { where: { username: allUsers }, populate: true }
                     // {
                     //    where: {
                     //       glue: "and",
                     //       rules: [
                     //          {
                     //             key: "username",
                     //             rule: "in",
                     //             value: allUsers,
                     //          },
                     //       ],
                     //    },
                     //    populate: true,
                     // },
                     // {} // <-- user data isn't used in our condition
                  )
                  .then(resolve)
                  .catch(reject);

               // SiteUser.find({ username: allUsers })
               //    .then((listUsers) => {
               //       resolve(listUsers);
               //    })
               //    .catch(reject);
            })
            .catch((err) => {
               reject(err);
            });
      });
   }
};
