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
 * @param {array}
 * @return {Promise}
 */
module.exports = function (AB, currentObject, data) {
   // NOTE: kept this as a promise for future possibilities of data we might
   // need to check or verify...

   return new Promise((resolve /* , reject */) => {
      var UserObj = AB.objectUser();
      if (currentObject.id === UserObj.id) {
         (data || []).forEach((r) => {
            delete r.password;
            delete r.salt;
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
                     delete entry.password;
                     delete entry.salt;
                  });
               });
            }
         });
      }

      resolve(data);
   });
};
