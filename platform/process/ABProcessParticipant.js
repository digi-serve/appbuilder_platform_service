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
      if (data.ids.indexOf(this.id) > -1) return;

      data.ids.push(this.id);

      // add any related roles
      if (this.useRole) {
         var roles = this.role;
         if (!Array.isArray(roles)) {
            roles = [roles];
         }
         roles.forEach((rid) => {
            data.roles[rid] = rid;
         });
      }
   }

   /**
    * @method exportIDs()
    * export any relevant .ids for the necessary operation of this application.
    * @param {array} ids
    *        the array of ids to store our relevant .ids into
    */
   exportIDs(ids) {
      ids.push(this.id);
   }

   users(req) {
      return new Promise((resolve, reject) => {
         var allLookups = [];
         allLookups.push(this.usersForRoles(req));
         allLookups.push(this.usersForAccounts(req));

         Promise.all(allLookups)
            .then((results) => {
               var users = results[0].concat(results[1]);
               users = _.uniqBy(users, "uuid");
               resolve(users);
            })
            .catch(reject);
      });
   }

   usersForAccounts(req) {
      return new Promise((resolve, reject) => {
         if (!this.useAccount) {
            resolve([]);
            return;
         }
         if (!Array.isArray(this.account)) {
            this.account = [this.account];
         }

         // check if this.account is either a .uuid or .username
         req.retry(() =>
            this.AB.objectUser()
               .model()
               .find({
                  or: [{ uuid: this.account }, { username: this.account }],
               })
         )
            .then((listUsers) => {
               resolve(listUsers);
            })
            .catch(reject);
      });
   }

   usersForRoles(req) {
      return new Promise((resolve, reject) => {
         if (!this.useRole) {
            resolve([]);
            return;
         }

         if (!Array.isArray(this.role)) {
            this.role = [this.role];
         }

         // lookup the current list of Roles we are defined to use.
         req.retry(() =>
            this.AB.objectRole()
               .model()
               .find({ where: { uuid: this.role }, populate: true }, req)
         )

            .then((result = []) => {
               // for each role, compile a list of Users->usernames
               var allUsers = [];
               (result || []).forEach((role) => {
                  var usernames = (role.users || []).map((u) => {
                     // NOTE: ABFieldUser connections are linked via username
                     return u.username || u;
                  });
                  allUsers = allUsers.concat(usernames);
               });

               // make sure we remove any duplicates
               allUsers = this.AB.uniq(allUsers);

               // now return our SiteUsers based upon these usernames
               req.retry(() =>
                  this.AB.objectUser()
                     .model()
                     .find(
                        { where: { username: allUsers }, populate: false },
                        req
                     )
               )
                  .then(resolve)
                  .catch(reject);
            })
            .catch((err) => {
               reject(err);
            });
      });
   }
};
