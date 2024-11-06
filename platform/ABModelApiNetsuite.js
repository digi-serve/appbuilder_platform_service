//
// ABModelAPINetsuite
//
// Represents the Data interface for an ABObjectApiNetsuite object.

const _ = require("lodash");
const axios = require("axios");
const crypto = require("crypto");
const moment = require("moment");
const OAuth = require("oauth-1.0a");

const ABModel = require("./ABModel.js");

const CONCURRENCY_LIMIT = 20;
// {int}
// This is the number of parallel operations we want to limit ourselves to
// so we avoid trippig NetSuit's CONCURRENCY_LIMIT_EXCEEDED

/**
 * (taken from https://github.com/digi-serve/global-hr-update/blob/master/back-end/api/netsuite.js)
 * Make an authorized HTTP request to NetSuite.
 *
 * This takes care of the OAuth 1.0 headers.
 * Used internally within this file only.
 *
 * @param {obj} cred
 *        Our Credentials object that contains our Netsuite & OAuth information.
 *        cred.token
 *        cred.oauth
 *        cred.NETSUITE_* environment variables
 *
 * @param {string} url
 * @param {string} [method]
 *        Default is 'GET'
 * @param {object} [data]
 *        Optional JSON data to be included in the request body.
 * @param {object} [headers]
 *        Optional dictionary of headers to add to the request.
 * @return {object}
 *      {
 *          status: <integer>, // HTTP status code
 *          data: <json>
 *      }
 */
async function fetch(cred, url, method = "GET", data = null, headers = {}) {
   let { oauth, token, NETSUITE_REALM } = { ...cred };
   let requestData = { url, method };
   requestData.headers = oauth.toHeader(oauth.authorize(requestData, token));
   requestData.headers["Authorization"] += `, realm="${NETSUITE_REALM}"`;
   requestData.headers["Content-Type"] = "application/json";
   for (let key in headers) {
      requestData.headers[key] = headers[key];
   }

   // Include optional JSON body
   if (method.toLowerCase() != "get" && typeof data == "object") {
      requestData.data = data;
   }

   try {
      let result = await axios(requestData);
      return result;
   } catch (err) {
      if (err.response) {
         console.error("URL: " + url);
         console.error("Reponse status " + err.response.status);
         console.error(err.response.data);
      }
      throw err;
   }
}

module.exports = class ABModelAPINetsuite extends ABModel {
   constructor(object) {
      super(object);

      this.credentials = null;
      // {value hash}
   }

   oauthPreparation(credentials) {
      // Create Token and OAuth
      credentials.token = {
         key: credentials.NETSUITE_TOKEN_KEY,
         secret: credentials.NETSUITE_TOKEN_SECRET,
      };
      credentials.oauth = OAuth({
         consumer: {
            key: credentials.NETSUITE_CONSUMER_KEY,
            secret: credentials.NETSUITE_CONSUMER_SECRET,
         },
         signature_method: "HMAC-SHA256",
         hash_function(text, key) {
            return crypto
               .createHmac("sha256", key)
               .update(text)
               .digest("base64");
         },
      });
   }

   pullCredentials() {
      let credentials = {};
      Object.keys(this.object.credentials).forEach((k) => {
         let val = this.object.credentials[k];
         if (val.indexOf("ENV:") == 0) {
            val = process.env[val.replace("ENV:", "")] || "??";
         } else if (val.indexOf("SECRET:") == 0) {
            req.log("TODO: decode SECRET here");
         } else {
            // val remains credentials[k]
         }

         credentials[k] = val;
      });

      if (credentials) {
         this.oauthPreparation(credentials);
      }

      return credentials;
   }
   ///
   /// Instance Methods
   ///

   processError(url, msg, err, req) {
      if (req) {
         req.log(url);
         req.log(msg, err.response?.status, err.response?.data);
      }

      let message = "Rejected by NetSuite. ";
      if (err.response?.data["o:errorDetails"]) {
         message += err.response.data["o:errorDetails"][0].detail;
      }
      throw new Error(message);
   }

   /**
    * @method create
    * performs an update operation
    * @param {obj} values
    *    A hash of the new values for this entry.
    * @param {Knex.Transaction?} trx - [optional]
    * @param {ABUtil.reqService} req
    *    The request object associated with the current tenant/request
    * @return {Promise} resolved with the result of the find()
    */
   async create(values, trx = null, condDefaults = null, req = null) {
      if (!this.credentials) {
         this.credentials = this.pullCredentials();
      }

      // make sure we ONLY have valid field values in {values}
      var baseValues = this.object.requestParams(values);
      var addRelationParams = this.object.requestRelationParams(values);

      // created_at & updated_at
      // we might have these values set already due to some of our widgets
      // so let's pull those values out, and translate them back into the
      // Netsuite related values:
      var date = this.AB.rules.toSQLDateTime(new Date());
      ["created_at", "updated_at"].forEach((field) => {
         let val = baseValues[field] || date;
         delete baseValues[field];
         if (this.object.columnRef[field]) {
            baseValues[this.object.columnRef[field]] = val;
         }
      });

      let validationErrors = this.object.isValidData(baseValues);
      if (validationErrors.length > 0) {
         return Promise.reject(validationErrors);
      }

      // Make sure our Relations are set:
      // we can insert the connections in this manner:
      // "subsidiary": { "id": "1" }
      this.insertRelationValuesToSave(baseValues, addRelationParams);

      let url = `${
         this.credentials.NETSUITE_BASE_URL
      }/${this.object.dbTableName()}`;

      let response;
      try {
         response = await fetch(this.credentials, url, "POST", baseValues);
      } catch (err) {
         this.processError(
            `POST ${url}`,
            `Error creatomg ${this.object.dbTableName()} data`,
            err,
            req
         );
      }

      let location = response?.headers["location"];
      // let regEx = new RegExp(`${this.object.dbTableName()}\/(\d+)$`);
      // let match = location.match(regEx);
      // let id = match[1];
      let parts = location.split(`${this.object.dbTableName()}/`);
      let id = parts[1];

      // make sure we get a fully updated value for
      // the return value
      let rows = await this.findAll(
         {
            where: {
               glue: "and",
               rules: [
                  {
                     key: this.object.PK(),
                     rule: "equals",
                     value: id,
                  },
               ],
            },
            offset: 0,
            limit: 1,
            populate: true,
         },
         condDefaults,
         req
      );

      return rows[0];
   }

   /**
    * @method delete
    * performs a delete operation
    * @param {string} id
    *    the primary key for this update operation.
    * @param {Knex.Transaction?} trx - [optional]
    *
    * @return {Promise} resolved with {int} numRows : the # rows affected
    */
   async delete(id, trx = null, req = null) {
      // make sure we have built our credentials
      if (!this.credentials) {
         this.credentials = this.pullCredentials();
      }

      let url = `${
         this.credentials.NETSUITE_BASE_URL
      }/${this.object.dbTableName()}/${id}`;

      if (req) {
         req.performance.mark("delete-call");
      }

      try {
         let response = await fetch(this.credentials, url, "DELETE");
         // let location = response.headers["location"];
         // let parts = location.split(`${this.object.dbTableName()}/`);
         // let id = parts[1];

         if (req) {
            req.performance.measure("delete-call");
            if (response?.headers?.["x-netsuite-jobid"]) {
               req.log(
                  "Netsuite JobID:",
                  response?.headers?.["x-netsuite-jobid"]
               );
            }
         }

         return 1;
      } catch (err) {
         if (req) {
            req.performance.measure("delete-call");
         }
         this.processError(
            `DELETE ${url}`,
            `Error deleting ${this.object.dbTableName()} data`,
            err,
            req
         );
      }
   }

   /**
    * @method populateColumn()
    * given a ABFieldConnect definition, parse through the rows of data
    * and provide fully populated results for that column in the result.
    * @param {ABFieldConnect} field
    *    The field representing the specific column of data we are
    *    populating
    * @param {array} data
    *    The result of a fetch operation that now needs to populate
    *    it's results.
    *    NOTE: the data is populated in place.
    * @param {ABUtil.reqService} req
    *    The request object associated with the current tenant/request
    * @return {Promise}
    */
   async populateColumn(field, data, req) {
      // ok, so data = [ {row}, {row}... ]
      // each row will have a value (maybe) for this field

      // the value might be row.columnName = #
      // or it might be row.columnName = { PK : # }

      let pks = [];
      for (let i = 0; i < data.length; i++) {
         let row = data[i];
         let v = row[field.columnName];
         if (typeof v != "undefined") {
            if (Array.isArray(v)) {
               v.forEach((vv) => {
                  pks.push(vv);
               });
            } else {
               pks.push(v);
            }
         }
      }

      let linkObj = field.datasourceLink;
      let PK = linkObj.PK();

      // transform any { PK:# } into just #
      pks = pks
         .filter((v) => v)
         .map((val) => val[PK] || val)
         .filter((v) => v);

      let values = [];
      let where = {};
      where[PK] = pks;
      if (req) {
         values = await req.retry(() => linkObj.model().find(where));
      } else {
         values = await linkObj.model().find(where);
      }

      // convert to a hash  ID : { value }
      let valueHash = {};
      for (let i = 0; i < values.length; i++) {
         let val = values[i];
         valueHash[val[PK]] = val;
      }

      // now step through all the data rows, and update our values
      let linkType = field.linkType();
      for (let i = 0; i < data.length; i++) {
         let row = data[i];
         let v = row[field.columnName];
         if (v) {
            if (linkType == "one") {
               // ONE:xxx  this should only be 1 value
               v = v[PK] || v; // make sure it is just the PK

               row[field.relationName()] = valueHash[v];
               row[field.columnName] = v;
            } else {
               // Many:xxx : there could be > 1 here:
               if (!Array.isArray(v)) v = [v];

               v = v.map((vv) => vv[PK] || vv);

               row[field.relationName()] = v.map((vv) => valueHash[vv]);
               row[field.columnName] = v;
            }
         }
      }

      // done!
   }

   /**
    * @method populateColumnNonSource()
    * given a ABFieldConnect definition, parse through the rows of data
    * and provide fully populated results for that column in the result.
    * In this case, the provided data WONT contain the info for the connection.
    * We have to go lookup that data from the other table.
    * @param {ABFieldConnect} field
    *    The field representing the specific column of data we are
    *    populating
    * @param {array} data
    *    The result of a fetch operation that now needs to populate
    *    it's results.
    *    NOTE: the data is populated in place.
    * @param {ABUtil.reqService} req
    *    The request object associated with the current tenant/request
    * @return {Promise}
    */
   async populateColumnNonSource(field, data, req) {
      // ok, so data = [ {row}, {row}... ]

      let PK = field.object.PK();

      let pks = [];
      for (let i = 0; i < data.length; i++) {
         let row = data[i];
         pks.push(row[PK]);
      }

      let linkObj = field.datasourceLink;
      let linkField = field.fieldLink;

      // transform any { PK:# } into just #
      pks = pks.filter((v) => v);

      let values = [];
      let where = {};
      let col = linkField.columnName;
      where[col] = pks;
      if (req) {
         values = await req.retry(() => linkObj.model().find(where));
      } else {
         values = await linkObj.model().find(where);
      }

      // convert to a hash  ID : [{ value }]
      let valueHash = {};
      for (let i = 0; i < values.length; i++) {
         let val = values[i];
         if (typeof valueHash[val[col]] == "undefined") {
            valueHash[val[col]] = [];
         }
         valueHash[val[col]].push(val);
      }

      // now step through all the data rows, and update our values
      // let linkType = field.linkType();
      let otherPK = linkObj.PK();
      for (let i = 0; i < data.length; i++) {
         let row = data[i];
         let rowPK = row[PK];
         if (valueHash[rowPK]) {
            row[field.relationName()] = valueHash[rowPK];
            row[field.columnName] = valueHash[rowPK].map((v) => v[otherPK]);
         } else {
            row[field.relationName()] = [];
            row[field.columnName] = [];
         }

         // let v = row[field.columnName];
         // if (v) {
         //    if (linkType == "one") {
         //       // ONE:xxx  this should only be 1 value
         //       v = v[PK] || v; // make sure it is just the PK

         //       row[field.relationName()] = valueHash[v];
         //       row[field.columnName] = v;
         //    } else {
         //       // Many:xxx : there could be > 1 here:
         //       if (!Array.isArray(v)) v = [v];

         //       v = v.map((vv) => vv[PK] || vv);

         //       row[field.relationName()] = v.map((vv) => valueHash[vv]);
         //       row[field.columnName] = v;
         //    }
         // }
      }

      // done!
   }

   /**
    * @method populateColumnManyMany()
    * given a ABFieldConnect definition, parse through the rows of data
    * and provide fully populated results for that column in the result.
    * In this case, the data we are connecting to will happen through a
    * MANY:MANY connection.
    * @param {ABFieldConnect} field
    *    The field representing the specific column of data we are
    *    populating
    * @param {array} data
    *    The result of a fetch operation that now needs to populate
    *    it's results.
    *    NOTE: the data is populated in place.
    * @param {ABUtil.reqService} req
    *    The request object associated with the current tenant/request
    * @return {Promise}
    */
   async populateColumnManyMany(field, data, req) {
      // ok, so data = [ {row}, {row}... ]

      // 1) Get All Our PKs out of the data
      let PK = field.object.PK();

      let pks = [];
      for (let i = 0; i < data.length; i++) {
         let row = data[i];
         pks.push(row[PK]);
      }

      // 2) Now SQL lookup on join table to find ALL PKs of connected table
      let linkField = field.fieldLink;

      let sql = `SELECT * FROM ${field.settings.joinTable} WHERE ${
         field.settings.joinTableReference
      } IN ( ${pks.join(", ")} )`;

      let URL = `${this.credentials.NETSUITE_QUERY_BASE_URL}/suiteql`;

      let response = await fetch(
         this.credentials,
         URL,
         "POST",
         {
            q: sql,
         },
         { Prefer: "transient" }
      );

      let list = response.data.items;
      let hashConnections = {
         /* thisPK : { thatPK1:true, thatPK2: true } */
      };
      let thatPKs = {
         /* thatPK : true */
      }; // all the other objects we need to lookup
      let thisRef = field.settings.joinTableReference;
      let thatRef = linkField.settings.joinTableReference;

      for (let i = 0; i < list.length; i++) {
         let conn = list[i];
         let thisPK = conn[thisRef];
         if (typeof hashConnections[thisPK] == "undefined") {
            hashConnections[thisPK] = {};
         }
         hashConnections[thisPK][conn[thatRef]] = true;
         thatPKs[conn[thatRef]] = true;
      }
      thatPKs = Object.keys(thatPKs);

      // 3) SQL select all the rows from the dest table
      let linkObj = field.datasourceLink;
      let thatPK = linkObj.PK();
      let listLinkObj = [];
      if (thatPKs.length > 0) {
         sql = `SELECT * FROM ${linkObj.dbTableName()}  WHERE ${thatPK} IN ( ${thatPKs.join(
            ", "
         )} )`;

         let responseLinkObj = await fetch(
            this.credentials,
            URL,
            "POST",
            {
               q: sql,
            },
            { Prefer: "transient" }
         );

         listLinkObj = responseLinkObj.data.items;
      }
      let lookupLinkObj = {};
      for (let i = 0; i < listLinkObj.length; i++) {
         let lObj = listLinkObj[i];
         lookupLinkObj[lObj[thatPK]] = lObj;
      }

      // 4) Now for each row of data, insert linked objects
      for (let i = 0; i < data.length; i++) {
         let row = data[i];

         let connections = [];
         let values = [];
         let hashConn = hashConnections[row[PK]];
         if (hashConn) {
            connections = Object.keys(hashConn);

            for (let x = 0; x < connections.length; x++) {
               let cPK = connections[x];
               let v = lookupLinkObj[cPK];
               if (v) {
                  values.push(v);
               }
            }
         }

         row[field.relationName()] = values;
         row[field.columnName] = connections;
      }

      // done!
   }

   /**
    * @method populate()
    * given the requested condition value, perform any relevant population
    * of the data result.
    * @param {json} cond
    *    The condition value passed into our find() operations. There can
    *    be a cond.populate field that specifies how to populate the data.
    * @param {array} data
    *    The result of a fetch operation that now needs to populate
    *    it's results.
    *    NOTE: the data is populated in place.
    * @param {ABUtil.reqService} req
    *    The request object associated with the current tenant/request
    * @return {Promise}
    */
   async populate(cond, data, req) {
      let columns = [];

      // if .populate == false
      // if .populate not set, assume no
      if (!cond.populate || cond.populate === "false") return;
      // if .populate == true
      else if (typeof cond.populate == "boolean" || cond.populate === "true") {
         // pick ALL relations and populate them
         columns = this.object.connectFields();
      }

      // if .populate = [ "col1", "col2" ]
      else if (Array.isArray(cond.populate)) {
         // find these specific columns to populate
         cond.populate.forEach((col) => {
            let field = this.object.connectFields(
               (f) => f.columnName == col || f.id == col
            )[0];
            if (field) {
               columns.push(field);
            }
         });
      }
      if (req) {
         req.log(
            `populating columns : ${columns
               .map((f) => f.columnName)
               .join(", ")}`
         );
      }
      let allColumns = [];
      columns.forEach((col) => {
         let linkType = `${col.linkType()}:${col.linkViaType()}`;
         if (linkType == "one:one") {
            if (col.isSource()) {
               linkType = "one:many";
            } else {
               linkType = "many:one";
            }
         }
         switch (linkType) {
            case "one:many":
               allColumns.push(this.populateColumn(col, data, req));
               break;
            case "many:one":
               allColumns.push(this.populateColumnNonSource(col, data, req));
               break;
            case "many:many":
               allColumns.push(this.populateColumnManyMany(col, data, req));
               break;
            default:
               console.log("TODO: figure out additional link types");
         }
      });
      await Promise.all(allColumns);
   }

   /**
    * @method findAll
    * performs a data find with the provided condition.
    * @param {obj} cond
    *    A set of optional conditions to add to the find():
    * @param {obj} conditionDefaults
    *    A hash of default condition values.
    *    conditionDefaults.languageCode {string} the default language of
    *       the multilingual data to return.
    *    conditionDefaults.username {string} the username of the user
    *       we should reference on any user based condition
    * @param {ABUtil.reqService} req
    *    The request object associated with the current tenant/request
    * @return {Promise} resolved with the result of the find()
    */
   async findAll(cond, conditionDefaults, req) {
      // make sure we have built our credentials
      if (!this.credentials) {
         this.credentials = this.pullCredentials();
      }

      // now construct the URL (including limit & skip)
      let qs = "";
      if (cond.limit) qs = `limit=${cond.limit}`;
      if (cond.skip) {
         if (qs) qs += "&";
         qs = `${qs}offset=${cond.skip}`;
      }
      if (qs) qs = `?${qs}`;

      let URL = `${this.credentials.NETSUITE_QUERY_BASE_URL}/suiteql${qs}`;

      // first, pull out our "have_no_relation" rules for later:
      var noRelationRules = [];
      cond.where = this.queryConditionsPluckNoRelations(
         cond.where,
         noRelationRules
      );

      // where is now our "SELECT ... WHERE {where}" values
      let where = [];
      let w = this.sqlConditions(cond.where, conditionDefaults, req);
      if (w) {
         w = w.replaceAll("`", ""); // Netsuite doesn't like `
         where.push(w);
      }

      let tableNJoin = [this.object.dbTableName()];
      // {array}
      // an array of sql table and JOIN statements that will result in the
      // SELECT ... FROM {tableNJoin}  WHERE ....

      // Special Case:  'have_no_relation'
      // 1:1 - Get rows that no relation with
      // var noRelationRules = (where.rules || []).filter(
      //    (r) => r.rule == "have_no_relation"
      // );
      noRelationRules.forEach((r) => {
         // var relation_name = AppBuilder.rules.toFieldRelationFormat(field.columnName);

         // var objectLink = field.objectLink();
         // if (!objectLink) return;

         // Query
         //  .leftJoinRelation(relation_name)
         //  .whereRaw('{relation_name}.{primary_name} IS NULL'
         //    .replace('{relation_name}', relation_name)
         //    .replace('{primary_name}', objectLink.PK()));

         // {
         //  key: "COLUMN_NAME", // no need to include object name
         //  rule: "have_no_relation",
         //  value: "LINK_OBJECT_PK_NAME"
         // }

         var field = this.object.fields((f) => f.id == r.key)[0];

         var objectLink = field.datasourceLink;
         if (!objectLink) return;

         var fieldLink = field.fieldLink;
         if (!fieldLink) return;

         let JOINTABLE = objectLink.dbTableName();
         // {string}
         // the table we are performing the JOIN to.
         // in most cases it will be with objectLink

         // r.value = objectLink.PK();
         let linkType = `${field.linkType}:${field.linkViaType}`;

         // NOTE: on the theoretical one:one relation, isSource will determine
         // how the data is organized.  We use that to see if it stores it's data
         // like a one:many or many:one relation:
         if (linkType == "one:one") {
            if (field.isSource) {
               linkType = "one:many";
            } else {
               linkType = "many:one";
            }
         }

         let ON = "";
         let WHERE = null;
         switch (linkType) {
            case "one:many":
               // this means that object has the column that contains objectLink's pk
               ON = `${this.object.dbTableName()}.${
                  field.columnName
               } = ${objectLink.dbTableName()}.${objectLink.PK()}`;
               WHERE = `${this.object.dbTableName()}.${
                  field.columnName
               } IS NULL`;
               break;

            case "many:one":
               // this means that objectLink has the column that contains object's pk
               ON = `${this.object.dbTableName()}.${this.object.PK()} = ${objectLink.dbTableName()}.${
                  fieldLink.columnName
               }`;
               WHERE = `${objectLink.dbTableName()}.${
                  fieldLink.columnName
               } IS NULL`;
               break;

            case "many:many":
               // we need to go through a join table ?
               JOINTABLE = "?? many:many ?? "; // HOW DO I FIND THE JOIN TABLE IN NETSUITE?
               ON = ""; // AND HOW DO I FIND THE JOINTABLE.COLUMN in NETSUITE?
               WHERE = `?? `; // want to find fieldLink's column IS NULL
               let todoError = new Error(
                  "TODO: figure out Netsuite many:many connections"
               );
               throw todoError;
               break;
         }

         let join = `LEFT JOIN ${JOINTABLE} ON ${ON}`;
         tableNJoin.push(join);
         if (WHERE) {
            where.push(WHERE);
         }
      });

      // Now put this SQL together:
      let sql = `SELECT * FROM ${tableNJoin.join(" ")}`;
      if (where.length) {
         sql = `${sql} WHERE ${where.join(" AND ")}`;
      }

      // Let's not forget SORT:
      let sorts = [];
      if (!_.isEmpty(cond.sort)) {
         cond.sort.forEach((o) => {
            // o.key. : reference to the field
            // o.dir. : "ASC" or "DESC"
            var orderField = this.object.fieldByID(o.key);
            if (!orderField) return;

            sorts.push(`${orderField.columnName} ${o.dir}`);
         });
      }
      if (sorts.length > 0) {
         sql = `${sql} ORDER BY ${sorts.join(", ")}`;
      }

      if (req) {
         req.log("Netsuite SQL:", sql);
         req.performance.mark("initial-find");
      }
      try {
         let response = await fetch(
            this.credentials,
            URL,
            "POST",
            {
               q: sql,
            },
            { Prefer: "transient" }
         );
         // console.log(response);

         let list = response.data.items;
         if (req) {
            req.performance.measure("initial-find");
            req.performance.mark("populate");
         }
         await this.populate(cond, list, req);
         if (req) {
            req.performance.measure("populate");
         }
         return list;
      } catch (err) {
         this.processError(
            `POST ${URL}`,
            `Error finding ${this.object.dbTableName()} data`,
            err,
            req
         );
      }
   }

   /**
    * @method findCount
    * performs a data find to get the total Count of a given condition.
    * @param {obj} cond
    *    A set of optional conditions to add to the find():
    * @param {obj} conditionDefaults
    *    A hash of default condition values.
    *    conditionDefaults.languageCode {string} the default language of
    *       the multilingual data to return.
    *    conditionDefaults.username {string} the username of the user
    *       we should reference on any user based condition
    * @param {ABUtil.reqService} req
    *    The request object associated with the current tenant/request
    * @return {Promise} resolved with the result of the find()
    */
   async findCount(cond, conditionDefaults, req) {
      const returnData = await this.findAll(cond, conditionDefaults, req);

      // // Paging
      // const pagingValues = this.object.getPagingValues({
      //    skip: cond?.skip,
      //    limit: cond?.limit,
      // });
      // pagingValues.total

      return returnData?.length;
   }

   insertRelationValuesToSave(baseValues, updateRelationParams) {
      // Make sure our Relations are set:
      // we can insert the connections in this manner:
      // "subsidiary": { "id": "1" }
      Object.keys(updateRelationParams).forEach((k) => {
         let updateValue = updateRelationParams[k];
         let val = {};

         let field = this.object.connectFields((f) => f.columnName == k)[0];
         if (!field) return;

         // only do this if we are "one:many", or "one:one" & isSource
         let linkType = `${field.linkType()}:${field.linkViaType()}`;
         if (
            linkType == "one:many" ||
            (linkType == "one:one" && field.isSource())
         ) {
            // if we are clearing the value then set to null
            if (updateValue == null) {
               val = null;
            } else {
               // else format { PK: val }
               /*
               let linkObj = field.datasourceLink;
               if (!linkObj) return;

               val[linkObj.PK()] = updateValue; // `${updateValue}`;
*/
               val = `${updateValue}`;
            }

            baseValues[k] = val;

            delete updateRelationParams[k];
         }
      });
   }

   /**
    * @method synchronizeRelationValues()
    * Synchronize the remaining relations values that are not part of the
    * base values of this object. ( many:one or many:many relationships)
    * @param {int} id
    * @param {obj} values
    *        contains the remaining relation values sent into the update()
    *        command.
    * @param {ABUtils.req} req
    */
   async synchronizeRelationValues(id, values, req) {
      let allColumns = [];
      Object.keys(values).forEach((k) => {
         let field = this.object.connectFields((f) => f.columnName == k)[0];
         if (!field) return;

         let colVals = this.AB.cloneDeep(values[k]);

         let linkType = `${field.linkType}:${field.linkViaType}`;
         if (linkType == "many:one") {
            allColumns.push(this.syncColumnManyOne(id, field, colVals, req));
         } else {
            // must be many:many
            allColumns.push(this.syncColumnManyMany(id, field, colVals, req));
         }
      });

      await Promise.all(allColumns);
   }

   async syncColumnManyOne(id, field, values, req) {
      let URL = `${this.credentials.NETSUITE_QUERY_BASE_URL}/suiteql`;

      let linkField = field.fieldLink;
      let linkObject = field.datasourceLink;

      let sql = `SELECT * FROM ${linkObject.dbTableName()} WHERE ${
         linkField.columnName
      }=${id}`;
      if (req) {
         req.performance.mark(`${linkField.columnName}-lookup`);
      }
      // first get the old values:
      let response = await fetch(
         this.credentials,
         URL,
         "POST",
         {
            q: sql,
         },
         { Prefer: "transient" }
      );

      let oldValues = response.data.items;
      if (req) {
         req.performance.measure(`${linkField.columnName}-lookup`);
      }

      // just want the PKs here:
      oldValues = oldValues.map((v) => v[linkObject.PK()] || v);

      let removeThese = [];
      oldValues.forEach((v) => {
         // if v is in values,
         let newV = values.find((nV) => nV == v);
         if (newV) {
            // if we found it, then remove that entry from values
            values = values.filter((nV) => nV != v);
         } else {
            // we didn't find it, so add it to removeThese
            removeThese.push(v);
         }
      });

      let addDrop = [];

      addDrop.push(this.relate(id, field, values, req));
      addDrop.push(this.unRelate(id, field, removeThese, req));

      await Promise.all(addDrop);
   }

   async relate(id, field, values, req) {
      if (values.length == 0) return;

      let linkField = field.fieldLink;
      let object = field.object;
      let setVal = {};
      let newVal = {};
      newVal[object.PK()] = id; // `"${id}"`;
      setVal[linkField.columnName] = newVal;

      await this.relateOP(id, field, values, setVal, req);
   }

   async unRelate(id, field, values, req) {
      if (values.length == 0) return;

      let linkField = field.fieldLink;
      let setVal = {};
      setVal[linkField.columnName] = null;

      await this.relateOP(id, field, values, setVal, req);
   }

   async relateOP(id, field, values, setVal, req) {
      // let linkField = field.fieldLink;
      let linkObject = field.datasourceLink;

      let allUpdates = [];
      values.forEach((vid) => {
         let url = `${
            this.credentials.NETSUITE_BASE_URL
         }/${linkObject.dbTableName()}/${vid}`;

         try {
            allUpdates.push(fetch(this.credentials, url, "PATCH", setVal));
         } catch (err) {
            this.processError(
               `PATCH ${url}`,
               `Error updating ${this.object.dbTableName()} data`,
               err,
               req
            );
         }
      });

      await Promise.all(allUpdates);
   }

   async syncColumnManyMany(id, field, values, req) {
      let URL = `${this.credentials.NETSUITE_QUERY_BASE_URL}/suiteql`;

      let sql = `SELECT * FROM ${field.settings.joinTable} `;

      let cond = [];
      // set initial myPK condition
      cond.push(`${field.settings.joinTableReference}=${id}`);

      // if this joinTable has an active/inactive fields,
      // then push the active cond
      if (field.settings.joinActiveField) {
         cond.push(
            `${field.settings.joinActiveField}=${field.settings.joinActiveValue}`
         );
      }

      // now combine the full SQL here
      sql = `${sql} WHERE ${cond.join(" AND ")}`;

      if (req) {
         req.performance.mark(`${field.columnName}-lookup`);
      }
      // first get the old values:
      let response = await fetch(
         this.credentials,
         URL,
         "POST",
         {
            q: sql,
         },
         { Prefer: "transient" }
      );

      let oldValues = response.data.items;
      if (req) {
         req.performance.measure(`${field.columnName}-lookup`);
      }

      // just want the PKs of the incoming values here:
      let linkField = field.fieldLink;
      let PK = linkField.settings.joinTableReference;
      oldValues = oldValues.map((v) => v[PK] || v);

      let removeThese = [];
      oldValues.forEach((v) => {
         // if v is in values,
         let newV = values.find((nV) => nV == v);
         if (newV) {
            // if we found it, then remove that entry from values
            values = values.filter((nV) => nV != v);
         } else {
            // we didn't find it, so add it to removeThese
            removeThese.push(v);
         }
      });

      let addDrop = [];

      addDrop.push(this.relateMany(id, field, values, req));
      addDrop.push(this.unRelateMany(id, field, removeThese, req));

      await Promise.all(addDrop);
   }

   async relateMany(id, field, values, req) {
      if (values.length == 0) return;

      let url = `${this.credentials.NETSUITE_BASE_URL}/${field.settings.joinTable}`;

      let linkField = field.fieldLink;

      let allRelates = [];
      let parallelCount = 0;
      for (let i = 0; i < values.length; i++) {
         let v = values[i];

         let newVal = {};
         newVal[field.settings.joinTableReference] = id;
         newVal[linkField.settings.joinTableReference] = v;

         if (field.settings.joinActiveField) {
            newVal[field.settings.joinActiveField] =
               field.settings.joinActiveValue;
         }

         allRelates.push(fetch(this.credentials, url, "POST", newVal));

         // check concurrency limit
         parallelCount++;
         if (parallelCount >= CONCURRENCY_LIMIT) {
            await Promise.all(allRelates); // wait for those to complete
            allRelates = []; // start next batch
            parallelCount = 0;
         }
      }

      // finish off any remaining operations
      await Promise.all(allRelates);
   }

   async unRelateMany(id, field, values, req) {
      if (values.length == 0) return;

      let linkField = field.fieldLink;

      // get the related rows we need to unrelate:
      let URL = `${this.credentials.NETSUITE_QUERY_BASE_URL}/suiteql`;

      let sql = `SELECT * FROM ${field.settings.joinTable}`;

      let conditions = [];
      conditions.push(`${field.settings.joinTableReference}=${id}`);
      conditions.push(
         `${linkField.settings.joinTableReference} IN ( ${values.join(", ")} )`
      );
      if (field.settings.joinActiveField) {
         conditions.push(
            `${field.settings.joinActiveField}=${field.settings.joinActiveValue}`
         );
      }

      sql = `${sql} WHERE ${conditions.join(" AND ")}`;

      let response = await fetch(
         this.credentials,
         URL,
         "POST",
         {
            q: sql,
         },
         { Prefer: "transient" }
      );

      let oldValues = response.data.items;
      oldValues = oldValues.map((v) => v[field.settings.joinTablePK]);

      // there are 2 ways to unrelate
      // 1) by setting the link inactive
      // 2) by removing the link

      if (field.settings.joinActiveField) {
         await this.unRelateManyInactive(id, field, oldValues, req);
      } else {
         await this.unRelateManyDelete(id, field, oldValues, req);
      }
   }

   async unRelateManyInactive(id, field, pks, req) {
      let url = `${this.credentials.NETSUITE_BASE_URL}/${field.settings.joinTable}/`;

      let updateValue = {};
      updateValue[field.settings.joinActiveField] =
         field.settings.joinInActiveValue;

      if (req) {
         req.performance.mark("update-unrelate-many");
      }

      let allUnRelates = [];
      let parallelCount = 0;
      for (let i = 0; i < pks.length; i++) {
         allUnRelates.push(
            await fetch(
               this.credentials,
               `${url}${pks[i]}`,
               "PATCH",
               updateValue
            )
         );
         parallelCount++;
         if (parallelCount >= CONCURRENCY_LIMIT) {
            await Promise.all(allUnRelates);
            allUnRelates = [];
            parallelCount = 0;
         }
      }

      await Promise.all(allUnRelates);
   }

   async unRelateManyDelete(id, field, pks, req) {
      let url = `${this.credentials.NETSUITE_BASE_URL}/${field.settings.joinTable}/`;

      if (req) {
         req.performance.mark("update-unrelate-many");
      }

      let allUnRelates = [];
      let parallelCount = 0;
      for (let i = 0; i < pks.length; i++) {
         allUnRelates.push(
            await fetch(this.credentials, `${url}${pks[i]}`, "DELETE")
         );
         parallelCount++;
         if (parallelCount >= CONCURRENCY_LIMIT) {
            await Promise.all(allUnRelates);
            allUnRelates = [];
            parallelCount = 0;
         }
      }

      await Promise.all(allUnRelates);
   }

   /**
    * @method update
    * performs an update operation
    * @param {string} id
    *   the primary key for this update operation.
    * @param {obj} values
    *   A hash of the new values for this entry.
    * @param {Knex.Transaction?} trx - [optional]
    *
    * @return {Promise} resolved with the result of the find()
    */
   async update(id, values, userData, trx = null, req = null) {
      let PK = this.object.PK();
      id = id[PK] || id.id || id.uuid || id;
      // id should be just the .uuid or .id value of the row we are updating
      // but in case they sent in a condition obj: { uuid: 'xyz' } lets try to
      // de-reference it.

      let baseValues = this.object.requestParams(values);
      // {valueHash} baseValues
      // return the parameters from the input params that relate to this object
      // exclude connectObject data field values

      let updateRelationParams = this.object.requestRelationParams(values);
      // {valueHash} updateRelationParams
      // return the parameters of connectObject data field values

      let transParams = this.AB.cloneDeep(baseValues.translations);
      // {array} transParams
      // get translations values for the external object
      // it will update to translations table after model values updated

      // oldValue = oldValue[0];
      // {obj} oldValue
      // the current value of the entry in the DB.

      if (!this.credentials) {
         this.credentials = this.pullCredentials();
      }

      // created_at & updated_at
      // we might have these values set already due to some of our widgets
      // so let's pull those values out, and translate them back into the
      // Netsuite related values:
      var date = this.AB.rules.toSQLDateTime(new Date());
      ["updated_at"].forEach((field) => {
         let val = baseValues[field] || date;
         delete baseValues[field];
         if (this.object.columnRef[field]) {
            baseValues[this.object.columnRef[field]] = val;
         }
      });

      // All Netsuite DateTime fields need to be in ISOFormat:
      this.object
         .fields((f) => f.key == "datetime")
         .forEach((f) => {
            if (baseValues[f.columnName]) {
               baseValues[f.columnName] = new Date(
                  baseValues[f.columnName]
               ).toISOString();
            }
         });

      // Booleans should be "T" or "F"
      this.object
         .fields((f) => f.key == "boolean")
         .forEach((f) => {
            if (typeof baseValues[f.columnName] != "undefined") {
               if (baseValues[f.columnName]) {
                  baseValues[f.columnName] = "T";
               } else {
                  baseValues[f.columnName] = "F";
               }
            }
         });

      let validationErrors = this.object.isValidData(baseValues);
      if (validationErrors.length > 0) {
         return Promise.reject(validationErrors);
      }

      // Make sure our Relations are set:
      // This routine will insert values that are one:many where we
      // track the connection value ourselves.
      // we can insert the connections in this manner:
      // "subsidiary": { "id": "1" }
      this.insertRelationValuesToSave(baseValues, updateRelationParams);

      let url = `${
         this.credentials.NETSUITE_BASE_URL
      }/${this.object.dbTableName()}/${id}`;

      // // insert our replace header
      // let allConnectionColumns = this.object
      //    .connectFields()
      //    .map((f) => f.columnName);
      // let replace = [];
      // Object.keys(baseValues).forEach((k) => {
      //    if (allConnectionColumns.indexOf(k) > -1) {
      //       replace.push(k);
      //    }
      // });
      // if (replace.length > 0) {
      //    url = `${url}?replace=${replace.join(",")}`;
      // }

      if (req) {
         req.log(
            "ABModelApiNetsuite.update(): updating initial params:",
            baseValues
         );
         req.performance.mark("update-base");
      }

      try {
         let response = await fetch(this.credentials, url, "PATCH", baseValues);
      } catch (err) {
         this.processError(
            `PATCH ${url}`,
            `Error updating ${this.object.dbTableName()} data`,
            err,
            req
         );
      }

      if (req) {
         req.performance.measure("update-base");
         req.performance.mark("update-syncRelationValues");
      }

      await this.synchronizeRelationValues(id, updateRelationParams, req);

      if (req) {
         req.performance.measure("update-syncRelationValues");
         req.performance.mark("update-find-updated-entry");
      }

      let findAllParams = {
         where: {
            glue: "and",
            rules: [
               {
                  key: PK,
                  rule: "equals",
                  value: id,
               },
            ],
         },
         offset: 0,
         limit: 1,
         populate: true,
      };
      // {obj} findAllParams
      // the .findAll() condition params to pull the current value of this obj
      // out of the DB.

      let newValue = await this.findAll(findAllParams, userData, req);

      if (req) {
         req.performance.measure("update-find-updated-entry");
      }

      return newValue[0];
   }

   sqlConditions(where, conditionDefaults, req) {
      if (_.isEmpty(where)) return null;

      // if (req) {
      //    req.log(
      //       "ABModel.queryConditions(): .where condition:",
      //       JSON.stringify(where, null, 4)
      //    );
      // }

      // first, pull out our "have_no_relation" rules for later:
      var noRelationRules = [];

      // make sure we don't edit the passed in where object
      where = this.AB.cloneDeep(where);

      where = this.queryConditionsPluckNoRelations(where, noRelationRules);

      // Now walk through each of our conditions and turn them into their
      // sql WHERE statements
      var whereParsed = this.queryConditionsParseConditions(
         where,
         conditionDefaults,
         req
      );

      // now join our where statements according to the .glue values
      return this.queryConditionsJoinConditions(whereParsed, req);
   }
};
