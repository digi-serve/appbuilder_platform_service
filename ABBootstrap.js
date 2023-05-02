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

var Listener = null;
// {abServiceSubscriber}
// A Subscriber for the definition.* published messages.

/**
 * @function staleHandler()
 * handles resetting the ABFactory for the Tenant that just had their
 * definitions updated.
 * Definitions will be reloaded the next time a relevant request needs
 * that tenant's data.
 */
function staleHandler(req) {
   var tenantID = req.tenantID();
   Factories[tenantID]?.emit("bootstrap.stale.reset");
   KnexPool[tenantID] = Factories[tenantID].Knex.connection();
   delete Factories[tenantID];
   req.log(`:: Definitions reset for tenant[${tenantID}]`);
}

var PendingFactory = {
   /* tenantID : Promise */
};
// {hash}
// A lookup of Pending Factory builds.  This prevents the SAME factory from
// being built at the same time.

var KnexPool = {
   /* tenantID : AB.Knex.connection() */
};
// {hash}
// When definitions are updated, we destroy the existing ABFactory and create
// a new one.  However each new ABFactory will create a NEW KNEX DB POOL and
// eventually we use up all our DB Connections ( error: ER_CON_COUNT_ERROR).
// The Knex connection won't change due to the Definition updates, so let's
// cache the KnexPools here and reuse them.

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
               req.log(`:: Loading Definitions for tenant[${tenantID}]`);
               if (!PendingFactory[tenantID]) {
                  PendingFactory[tenantID] = queryAllDefinitions(req).then(
                     (defs) => {
                        if (defs && Array.isArray(defs) && defs.length) {
                           var hashDefs = {};
                           defs.forEach((d) => {
                              hashDefs[d.id] = d;
                           });

                           var newFactory = new ABFactory(
                              hashDefs,
                              DefinitionManager,
                              req.toABFactoryReq(),
                              KnexPool[tenantID]
                           );

                           newFactory.id = tenantID;

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
                                 Factories[tenantID]?.emit(
                                    "bootstrap.stale.reset"
                                 );
                                 KnexPool[tenantID] =
                                    Factories[tenantID]?.Knex.connection();
                                 delete Factories[tenantID];
                              });
                           });

                           Factories[tenantID] = newFactory;
                           delete PendingFactory[tenantID];

                           return newFactory.init();
                        }
                        req.notify.developer(
                           new Error(
                              `No Definitions returned for tenant[${tenantID}]`
                           ),
                           {
                              context: "ABBootstrap.queryAllDefinitions()",
                              tenantID,
                           }
                        );
                     }
                  );
               }
               return PendingFactory[tenantID];
            })
            .then(() => {
               // initialize Listener if not initialized
               if (!Listener) {
                  // record our stale handler
                  Listener = req.serviceSubscribe(
                     "definition.stale",
                     staleHandler
                  );

                  // attach staleHandler() to our other Events:
                  [
                     "definition.created",
                     "definition.destroyed",
                     "definition.updated",
                  ].forEach((e) => {
                     req.serviceSubscribe(e, staleHandler);
                  });
               }

               // return the ABFactory for this tenantID
               resolve(Factories[tenantID]);
            })
            .catch(reject);
      });
   },
};
