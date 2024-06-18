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

   if (data && !Array.isArray(data)) data = [data];

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

      pruneRelations(currentObject, data);

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

function pruneRelations(object, data) {
   if (!Array.isArray(data)) data = [data];
   if (data.filter((row) => row != null).length == 0) return;

   // find the connectedFields that are represented in the data object.
   let connectedFields = object
      .connectFields()
      .filter((f) => data[0]?.[f.relationName()]);
   var mlFields = object.multilingualFields();

   // using for loop for performance here
   for (var i = 0, data_length = data.length; i < data_length; ++i) {
      let row = data[i];
      if (row == null) continue;

      // Keep .id because it is custom index value to use reference to Connect field
      // delete row.id;
      mlFields.forEach((mf) => {
         delete row[mf];
      });

      connectedFields.forEach((f) => {
         // pull f => linkedObj

         // var minFields = linkObj.minRelationData();
         var relationName = f.relationName();
         var colName = f.columnName;

         // NOTE: If this connect field will use custom `indexField` or `indexField2`, then should not remove FK reference value
         if (!f.indexField && !f.indexField2) delete row[colName];

         if (row[relationName]) {
            var linkObj = f.datasourceLink;
            pruneRelations(linkObj, row[relationName]);
         }
      });
   }
}
