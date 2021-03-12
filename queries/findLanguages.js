module.exports = function (req) {
   return new Promise((resolve, reject) => {
      let tenantDB = req.tenantDB();
      if (tenantDB != "") {
         tenantDB += ".";
      } else {
         let errorNoTenant = new Error(
            `Unable to find tenant information for tenantID[${req.tenantID()}]`
         );
         reject(errorNoTenant);
         return;
      }

      let sql = `SELECT * FROM ${tenantDB}\`SITE_LANGUAGE\``;

      req.query(sql, [], (error, results /*, fields */) => {
         if (error) {
            req.log(sql);
            reject(error);
         } else {
            resolve(results);
         }
      });
   });
};
