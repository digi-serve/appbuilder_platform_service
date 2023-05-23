//
// cleanReturnData.js
// parse the return data of any ABObject and make sure certain fields are
// not returned.
//

/**
 * @function cleanReturnData()
 * @param {ABFactory} AB
 *			 the current ABFactory for the data in this tenant's request.
 * @param {ABObject} currentObject
 *			 the base ABObject this data is representing.
 * @param {array} data
 *        the incoming data we are modifying
 * @param {mixed} populate
 *        the passed in populate parameter (if any) that determines if we
 *        also return some of our problematic relations.
 * @return {Promise}
 */
module.exports = function (AB, currentObject, data, populate = false) {
   // NOTE: kept this as a promise for future possibilities of data we might
   // need to check or verify...

   return new Promise((resolve /* , reject */) => {
      var UserObj = AB.objectUser();
      if (currentObject.id === UserObj.id) {
         (data || []).forEach((r) => {
            cleanEntry(r, populate);
         });
      } else {
         // Or if this object connects to any SiteUsers
         var connFields = currentObject.connectFields();
         (connFields || []).forEach((f) => {
            if ((f.datasourceLink || {}).id == UserObj.id) {
               (data || []).forEach((r) => {
                  var fdata = f.dataValue(r);
                  if (!Array.isArray(fdata)) {
                     fdata = [fdata];
                  }
                  fdata.forEach((entry) => {
                     cleanEntry(entry, populate);
                  });
               });
            }
         });
      }

      resolve(data);
   });
};

var RemoveColumns = ["SITE_PROCESS_INSTANCE"];

function cleanEntry(r, p) {
   delete r.password;
   delete r.salt;

   // FIX: quick patch to prevent users with connections to this table
   // from crashing our services when encoding too much data.

   // if they did not specifically request our RemoveColumns, then remove them.
   if (!Array.isArray(p)) {
      RemoveColumns.forEach((c) => {
         delete r[c];
         delete r[`${c}__relation`];
      });
      return;
   }

   // if they DID request some columns, then don't delete them if they were
   // requested

   RemoveColumns.forEach((c) => {
      if (p.indexOf(c) == -1) {
         delete r[c];
         delete r[`${c}__relation`];
      }
   });
}
