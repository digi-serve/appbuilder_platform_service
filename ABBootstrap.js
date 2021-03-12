/*
 * ABBootstrap
 * This object manages preparing an ABFactory for a Specific Tenant.
 */

const queryAllDefinitions = require("./queries/allDefinitions");
// {sql} queryAllDefinitions
// the sql query to load all the Definitions from a specific tenant.

const Create = require("./queries/definitionCreate");
const Destroy = require("./queries/definitionDestroy");
const Find = require("./queries/definitionFind");
const Update = require("./queries/definitionUpdate");

const ABFactory = require("./ABFactory");

var Factories = {
   /* tenantID : { ABFactory }} */
};
// {hash}
// Sort out all known tenant aware factories by tenantID.

var DefinitionManager = {
   Create,
   Destroy,
   Find,
   Update,
};

module.exports = {
   init: (req) => {
      return new Promise((resolve, reject) => {
         var tenantID = req.tenantID();
         if (!tenantID) {
            var errorNoTenantID = new Error(
               "ABBootstrap.init(): could not resolve tenantID for request"
            );
            reject(errorNoTenantID);
            return;
         }

         Promise.resolve()
            .then(() => {
               // if we don't have any definitions for the given tenantID,
               // load them

               if (Factories[tenantID]) {
                  // Already there, so skip.
                  return;
               }

               return queryAllDefinitions(req).then((defs) => {
                  if (defs && Array.isArray(defs) && defs.length) {
                     var hashDefs = {};
                     defs.forEach((d) => {
                        hashDefs[d.id] = d;
                     });

                     var newFactory = new ABFactory(
                        hashDefs,
                        DefinitionManager,
                        req.toABFactoryReq()
                     );

                     // Reload our ABFactory whenever we detect any changes in
                     // our definitions.  This should result in correct operation
                     // even though changing definitions become an "expensive"
                     // operation. (but only for designers)
                     var resetOnEvents = [
                        "definition.created",
                        "definition.destroyed",
                        "definition.updated",
                     ];
                     resetOnEvents.forEach((event) => {
                        newFactory.on(event, () => {
                           delete Factories[tenantID];
                        });
                     });

                     Factories[tenantID] = newFactory;

                     return newFactory.init();
                  }
               });
            })
            .then(() => {
               // return the ABFactory for this tenantID
               resolve(Factories[tenantID]);
            })
            .catch(reject);
      });
   },
};
