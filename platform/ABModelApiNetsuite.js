//
// ABModelAPINetsuite
//
// Represents the Data interface for an ABObjectApiNetsuite object.

const _ = require("lodash");
const axios = require("axios");
const crypto = require("crypto");
const OAuth = require("oauth-1.0a");

const ABModel = require("./ABModel.js");

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

      /*
      // make sure a UUID is set
      var PK = this.object.PK();
      // Keep the passed in uuid if provided.
      if (PK === "uuid" && values[PK]) {
         baseValues[PK] = values[PK];
      }
      // if not, create a uuid
      if (PK === "uuid" && baseValues[PK] == null) {
         baseValues[PK] = this.AB.uuid();
      }
      */

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

      // TODO:
      // we can insert the connections in this manner:
      // "subsidiary": { "id": "1" }

      let url = `${
         this.credentials.NETSUITE_BASE_URL
      }/${this.object.dbTableName()}`;

      let response = await fetch(this.credentials, url, "POST", baseValues);

      let location = response.headers["location"];
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

      /*    

      return new Promise((resolve, reject) => {
         // get a Knex Query Object
         let query = this.modelKnex().query();

         // Used by knex.transaction, the transacting method may be chained to any query and
         // passed the object you wish to join the query as part of the transaction for.
         if (trx) query = query.transacting(trx);

         // update our value
         query
            .insert(baseValues)
            .then((returnVals) => {
               if (req) {
                  req.log(
                     `${
                        this.object.label || this.object.name
                     }.create() successful. Now loading full value from DB.`
                  );
               }
               if (returnVals) {
                  var relateTasks = [];
                  // {array}
                  // all the fn() calls that need to be performed to relate a task.

                  for (var colName in addRelationParams) {
                     let newVals = addRelationParams[colName];
                     if (!Array.isArray(newVals)) {
                        newVals = [newVals];
                     }

                     let fPK = "uuid";
                     let field = this.object.fields(
                        (f) => f.columnName == colName
                     )[0];
                     if (field) {
                        let objectLink = field.datasourceLink;
                        if (objectLink) {
                           fPK = objectLink.PK();
                        }
                     }

                     newVals = newVals
                        .filter((v) => v !== null)
                        .map((v) => v[fPK] || v.id || v.uuid || v);

                     // relateTasks.push(() =>
                     //    this.relate(returnVals[PK], colName, newVals, trx, req)
                     // );
                     AddToRelateTasks(
                        relateTasks,
                        this.object,
                        colName,
                        returnVals[PK],
                        newVals,
                        trx,
                        req
                     );
                  }
               }

               doSequential(relateTasks, (err) => {
                  if (err) {
                     return reject(err);
                  }

                  // no insert row
                  if (returnVals == null) {
                     resolve(null);
                     return;
                  }

                  // make sure we get a fully updated value for
                  // the return value
                  this.findAll(
                     {
                        where: {
                           glue: "and",
                           rules: [
                              {
                                 key: PK,
                                 rule: "equals",
                                 value: returnVals[PK],
                              },
                           ],
                        },
                        offset: 0,
                        limit: 1,
                        populate: true,
                     },
                     condDefaults,
                     req
                  )
                     .then((rows) => {
                        // this returns an [] so pull 1st value:
                        resolve(rows[0]);
                     })
                     .catch(reject);
               });
            })
            .catch((error) => {
               // populate any error messages with the SQL of this
               // query:
               try {
                  error._sql = query.toKnexQuery().toSQL().sql;
               } catch (e) {
                  error._sql = "??";
               }
               reject(error);
            });
      });
*/
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
      // const object = this.object;
      // const requestConfigs = object.request ?? {};
      // let url = requestConfigs.url;
      // let headers = object.headers;

      // // Paging
      // const pagingValues = object.getPagingValues({
      //    skip: cond?.skip,
      //    limit: cond?.limit,
      // });
      // if (Object.keys(pagingValues).length) {
      //    switch (requestConfigs.paging.type) {
      //       case "queryString":
      //          url = `${url}?${new URLSearchParams(pagingValues).toString()}`;
      //          break;
      //       case "header":
      //          headers = Object.assign(headers, pagingValues);
      //          break;
      //    }
      // }

      // // Get secret values and set to .headers
      // const pullSecretTasks = [];
      // Object.keys(headers).forEach((name) => {
      //    const val = headers[name]?.toString() ?? "";

      //    if (!val.startsWith("SECRET:")) return;

      //    const secretName = val.replace(/SECRET:/g, "");

      //    if (secretName)
      //       pullSecretTasks.push(
      //          (async () => {
      //             const secretVal = await object.getSecretValue(secretName);
      //             headers[name] = secretVal;
      //          })()
      //       );
      // });
      // await Promise.all(pullSecretTasks);

      // // Load data
      // const response = await fetch(url, {
      //    method: (requestConfigs.verb ?? "GET").toUpperCase(),
      //    headers,
      //    mode: "cors",
      //    cache: "no-cache",
      // });

      // // Convert to JSON
      // let result = await response.json();

      // // Extract data from key
      // result = this.object.dataFromKey(result);

      // // Convert to an Array
      // if (result && !Array.isArray(result)) result = [result];

      // return result;

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
         sql = `${sql} WHERE ${where.join(" AND")}`;
      }

      req.log("Netsuite SQL:", sql);
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

      return response.data.items;
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
