//
// ABModelAPINetsuite
//
// Represents the Data interface for an ABObjectApiNetsuite object.

const _ = require("lodash");
const axios = require("axios");
const crypto = require("crypto");
// const moment = require("moment");
const OAuth = require("oauth-1.0a");

const ABModel = require("./ABModel.js");

const CONCURRENCY_LIMIT = 20;
// {int}
// This is the number of parallel operations we want to limit ourselves to
// so we avoid trippig NetSuit's CONCURRENCY_LIMIT_EXCEEDED
// This is local to our Relate/unRelate operations

const CONCURRENCY_LIMIT_MAX = 200;
// {int}
// This is the number of parallel operations we want to limit ourselves to
// so we avoid trippig NetSuit's CONCURRENCY_LIMIT_EXCEEDED.
// This is global, across all our Netsuite API calls.

const TruthyValues = [true, 1, "1", "t", "true"];

var concurrency_count = 0;
// {int}
// a counter of the number of active requests we have made to NetSuite.

var concurrency_history = [];
// {int[]}
// a history of the number of active requests we have made to NetSuite over
// the past 5 seconds.

const RequestsActive = {};
// { jobID : {Promise} }
// a hash of all the active requests we have made to NetSuite.
// we use this to track the number of our requests.
// Object.keys(RequestsActive).length will give us the number of active requests.

const RequestsPending = [];
// {Promise[]}
// a list of all the requests that are waiting to be processed.

setInterval(() => {
   if (concurrency_history.length > 5) concurrency_history.shift();
   concurrency_history.push(concurrency_count);
   if (concurrency_count > 0) {
      console.log(
         `NetSuite API Concurrency: [${concurrency_history.join(
            ","
         )}] requests per second`
      );
   }
   if (Object.keys(RequestsActive).length > 0) {
      console.log(
         `NetSuite API Concurrency: ${
            Object.keys(RequestsActive).length
         } active requests`
      );
   }
   if (RequestsPending.length > 0) {
      console.log(
         `NetSuite API Concurrency: ${RequestsPending.length} pending requests`
      );
   }
   concurrency_count = 0;
}, 1000);
// report on our concurrency status every second

/**
 * function fetchPending()
 * This function is called whenever we have an open slot to process a new
 * request.  It will pull the next request from RequestsPending and process it.
 * If there are no requests pending, then it will do nothing.
 */
function fetchPending() {
   if (RequestsPending.length == 0) return;

   // get the next packet
   let packet = RequestsPending.shift();

   // make the request
   let f = fetch(
      packet.cred,
      packet.url,
      packet.method,
      packet.data,
      packet.headers
   );

   // register the request
   RequestsActive[packet.jobID] = f;
   f.then(packet.res)
      .catch(packet.rej)
      .finally(() => {
         // remove the request from our active list
         delete RequestsActive[packet.jobID];

         // look for more to process
         fetchPending();
      });
}
/**
 * function fetchConcurrent()
 * This function is a wrapper around the fetch() function that will manage
 * the number of concurrent requests we are making to NetSuite.
 * If we are at our limit, then the request will be queued up to be processed
 * when we have an open slot.
 *
 * @param {ABFactory} AB
 * @param {obj} cred
 *        Our Credentials object that contains our Netsuite & OAuth information.
 *        cred.token
 *        cred.oauth
 *        cred.NETSUITE_* environment variables
 * @param {string} url
 * @param {string} [method]
 *        Default is 'GET'
 * @param {object} [data]
 *        Optional JSON data to be included in the request body.
 * @param {object} [headers]
 *        Optional dictionary of headers to add to the request.
 * @returns {Promise}
 */
function fetchConcurrent(
   AB,
   cred,
   url,
   method = "GET",
   data = null,
   headers = {}
) {
   concurrency_count++;
   let jobID = AB.uuid();
   if (Object.keys(RequestsActive).length >= CONCURRENCY_LIMIT_MAX) {
      // we are at our limit, so we need to wait until we have an open slot
      let p = new Promise((resolve, reject) => {
         let pendingPacket = {
            res: resolve,
            rej: reject,
            jobID,
            cred,
            url,
            method,
            data,
            headers,
         };
         RequestsPending.push(pendingPacket);
      });
      return p;
   }

   let f = fetch(cred, url, method, data, headers);
   RequestsActive[jobID] = f;

   // ok, I know this is janky, but since our .finally() doesn't
   // care about the result or an error, I'm declaring it here
   // to make sure that no matter what, we continue our processing
   f.finally((result) => {
      delete RequestsActive[jobID];
      fetchPending();
      return result;
   });

   return f;
}

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

   /**
    * @method parseCondition
    * Return an SQL Where clause based upon the current condition object.
    * @param {obj} condition
    *        a QueryBuilder compatible condition object.
    *           cond.key : {string} The columnName or .uuid of the ABField this
    *                      condition is referencing.
    *           cond.rule: {string} The type of WHERE comparison we are making
    *           cond.value: {various} The comparison Value
    * @param {obj} userData
    *    The included user data for this request.
    * @param {ABUtil.reqService} req
    *        The request object associated with the current tenant/request
    */
   parseCondition(condition, userData, req) {
      // 'have_no_relation' condition will be applied later
      if (condition == null || condition.rule == "have_no_relation")
         return condition;

      let skipQuotes = false;
      // @const {boolean} skip adding `` around the key

      // Convert field id to column name
      if (this.AB.rules.isUUID(condition.key)) {
         var field = this.object.fields((f) => {
            return (
               f.id == condition.key &&
               (!condition.alias || f.alias == condition.alias)
            );
         })[0];
         if (field) {
            // convert field's id to column name
            condition.key = field.conditionKey(userData, req);

            // if we are searching a multilingual field it is stored in translations so we need to search JSON
            if (field.isMultilingual) {
               // TODO: move to ABOBjectExternal.js
               // TODO: Legacy Implementation to work with HRIS objects:
               // Refactor out when we no longer have to support HRIS objects:
               if (
                  !this.object.viewName && // NOTE: check if this object is a query, then it includes .translations already
                  (field.object.isExternal || field.object.isImported)
               ) {
                  // eslint-disable-next-line no-constant-condition  -- Phasing this section out
                  if (false) {
                     let transTable = field.object.dbTransTableName();

                     let prefix = "";
                     if (field.alias) {
                        prefix = "{alias}_Trans".replace(
                           "{alias}",
                           field.alias
                        );
                     } else {
                        prefix = "{databaseName}.{tableName}"
                           .replace(
                              "{databaseName}",
                              field.object.dbSchemaName()
                           )
                           .replace("{tableName}", transTable);
                     }

                     // update our condition key with the new prefix + columnName
                     condition.key = "{prefix}.{columnName}"
                        .replace("{prefix}", prefix)
                        .replace("{columnName}", field.columnName);

                     // eslint-disable-next-line no-unused-vars  -- Phasing this section out
                     let languageWhere =
                        '`{prefix}`.`language_code` = "{languageCode}"'
                           .replace("{prefix}", prefix)
                           .replace("{languageCode}", userData.languageCode);

                     // if (glue == "or") Query.orWhereRaw(languageWhere);
                     // else Query.whereRaw(languageWhere);
                  } else {
                     req.notify.developer(
                        new Error(
                           "running code to manage external multilingual Tables"
                        ),
                        {
                           field,
                        }
                     );
                  }
               } else {
                  let transCol = `${field
                     .dbPrefix()
                     .replace(/`/g, "")}.translations`;

                  // If it is a query
                  if (this.object.viewName) {
                     // just wrap the whole transCol in ``
                     transCol = "`" + transCol + "`";
                  } else {
                     // each piece of the transCol "dbname.tablename.colname" needs to be
                     // wrapped in ``  ( `dbname`.`tablename`.`colname` )
                     transCol = "`" + transCol.split(".").join("`.`") + "`"; // "{prefix}.translations";
                  }

                  condition.key =
                     this.AB.Knex.connection(/* connectionName */).raw(
                        'JSON_UNQUOTE(JSON_EXTRACT(JSON_EXTRACT({transCol}, SUBSTRING(JSON_UNQUOTE(JSON_SEARCH({transCol}, "one", "{languageCode}")), 1, 4)), \'$."{columnName}"\'))'
                           .replace(/{transCol}/g, transCol)
                           .replace(/{languageCode}/g, userData.languageCode)
                           .replace(/{columnName}/g, field.columnName)
                     );
               }
            }

            // if this is from a LIST, then make sure our value is the .ID
            else if (
               field.key == "list" &&
               field.settings &&
               field.settings.options &&
               field.settings.options.filter
            ) {
               // NOTE: Should get 'id' or 'text' from client ??
               var desiredOption = field.settings.options.filter(
                  (option) =>
                     option.id == condition.value ||
                     option.text == condition.value
               )[0];
               if (desiredOption) condition.value = desiredOption.id;
            }

            // DATE (not DATETIME)
            else if (
               field.key == "date" &&
               condition.rule != "last_days" &&
               condition.rule != "next_days" &&
               condition.rule != "is_current_date"
            ) {
               const dateVaue = condition.value;
               if (dateVaue)
                  condition.value = `TO_DATE('${
                     new Date(dateVaue).toISOString().split("T")[0]
                  }', 'YYYY-MM-DD')`;
            }

            // Search string value of FK column
            else if (
               ["connectObject", "user"].indexOf(field.key) > -1 &&
               [
                  "contain",
                  "not_contain",
                  "equals",
                  "not_equal",
                  "in",
                  "not_in",
               ].indexOf(condition.rule) != -1
            ) {
               this.convertConnectFieldCondition(field, condition);
            } else if (field.key == "formula" || field.key == "calculate") {
               skipQuotes = true;
            }
         }
      }

      // We are going to use the 'raw' queries for knex becuase the '.'
      // for JSON searching is misinterpreted as a sql identifier
      // our basic where statement will be:
      var whereRaw = "{fieldName} {operator} {input}";

      // make sure a value is properly Quoted:
      function quoteMe(value) {
         if (value && value.replace) {
            // FIX: You have an error in your SQL syntax; check the manual that corresponds to your MariaDB server version for the right syntax to use near '
            value = value.replace(/'/g, "''");
         }
         return "'" + value + "'";
      }

      // remove fields from rules
      var fieldTypes = [
         "number_",
         "string_",
         "date_",
         "datetime_",
         "boolean_",
         "user_",
         "list_",
         "connectObject_",
      ];

      // convert QB Rule to SQL operation:
      var conversionHash = {
         equals: "=",
         not_equal: "<>",
         is_empty: "IS NULL",
         is_not_empty: "IS NOT NULL",
         greater: ">",
         greater_or_equal: ">=",
         less: "<",
         less_or_equal: "<=",
         greater_current: ">",
         greater_or_equal_current: ">=",
         less_current: "<",
         less_or_equal_current: "<=",
         last_days: "BETWEEN",
         next_days: "BETWEEN",
         checked: "= 'T'",
         unchecked: "= 'F'", // FALSE or NULL
         // SQL queries
         like: "LIKE",
      };

      // normal field name:
      var columnName = condition.key;
      if (typeof columnName == "string" && !skipQuotes) {
         // make sure to ` ` columnName (if it isn't our special '1' condition )
         // see Policy:ABModelConvertSameAsUserConditions  for when that is applied
         if (columnName != "1") {
            if (columnName.indexOf("`") == -1) {
               // if columnName is  a  table.field  then be sure to `` each one individually
               var parts = columnName.split(".");
               for (var p = 0; p < parts.length; p++) {
                  parts[p] = "`" + parts[p] + "`";
               }
               columnName = parts.join(".");
            }

            // ABClassQuery:
            // If this is query who create MySQL view, then column name does not have `
            if (this.object.viewName) {
               columnName = "`" + columnName.replace(/`/g, "") + "`";
            }
         }
      }

      // remove the field type from the rule
      var rule = condition.rule;
      if (rule) {
         fieldTypes.forEach((f) => {
            rule = rule.replace(f, "");
         });
      }
      condition.rule = rule;
      // basic case:  simple conversion
      var operator = conversionHash[condition.rule];
      var value = condition.value;

      // If a function, then ignore quote. like DATE('05-05-2020')
      if (!RegExp("^[A-Z]+[(].*[)]$").test(value)) {
         value = quoteMe(value);
      }

      // special operation cases:
      switch (condition.rule) {
         case "like":
            // like: "searchTermWith%"
            operator = "LIKE";
            value = quoteMe(condition.value);
            break;

         case "begins_with":
            operator = "LIKE";
            value = quoteMe(condition.value + "%");
            break;

         case "not_begins_with":
            operator = "NOT LIKE";
            value = quoteMe(condition.value + "%");
            break;

         case "contains":
            operator = "LIKE";
            value = quoteMe("%" + condition.value + "%");
            break;

         case "not_contains":
            operator = "NOT LIKE";
            value = quoteMe("%" + condition.value + "%");
            break;

         case "ends_with":
            operator = "LIKE";
            value = quoteMe("%" + condition.value);
            break;

         case "not_ends_with":
            operator = "NOT LIKE";
            value = quoteMe("%" + condition.value);
            break;

         case "between":
            operator = "BETWEEN";
            value = condition.value
               .map(function (v) {
                  return quoteMe(v);
               })
               .join(" AND ");
            break;

         case "not_between":
            operator = "NOT BETWEEN";
            value = condition.value
               .map(function (v) {
                  return quoteMe(v);
               })
               .join(" AND ");
            break;

         case "is_current_user":
            operator = "=";
            value = quoteMe(userData.username);
            break;

         case "is_not_current_user":
            operator = "<>";
            value = quoteMe(userData.username);
            break;

         case "contain_current_user":
         case "not_contain_current_user":
            if (!userData.username) {
               if (condition.key == "contain_current_user") {
                  // if we wanted contains_current_user, but there wasn't a
                  // uservalue provided, then we want to make sure this
                  // condition doesn't return anything
                  //
                  // send a false by resetting the whereRaw to a fixed value.
                  // any future attempts to replace this will be ignored.
                  whereRaw = " 1=0 ";
               } else if (condition.key == "not_contain_current_user") {
                  // if we wanted not_contains_current_user, but there wasn't a
                  // uservalue provided, then we want to make sure this
                  // condition isn't limited by the lack of a username
                  //
                  // send a true by resetting the whereRaw to a fixed value.
                  // any future attempts to replace this will be ignored.
                  whereRaw = " 1=1 ";
               }
               break;
            }

            // Pull ABUserField when condition.key does not be .id of ABField
            if (field == null) {
               field = this.fields((f) => {
                  let condKey = (condition.key || "").replace(/`/g, "");

                  return (
                     condKey == f.columnName ||
                     condKey ==
                        `${f.dbPrefix()}.${f.columnName}`.replace(/`/g, "")
                  );
               })[0];
            }

            if (field) {
               // Query
               if (this.object.isQuery) {
                  // columnName = `JSON_SEARCH(JSON_EXTRACT(\`${
                  //    field.alias
                  // }.${field.relationName()}\`, '$[*].id'), 'one', '${
                  //    userData.username
                  // }')`;
                  // operator =
                  //    condition.rule != "contain_current_user" ? "IS" : "IS NOT";
                  // value = "NULL";

                  // WORKAROUND: 10.9.3-MariaDB-1:10.9.3+maria~ubu2204 has a JSON_EXTRACT bug.
                  // Believe it or not
                  //   SELECT `BASE_OBJECT.QX Code`, `BASE_OBJECT.Users__relation`, JSON_EXTRACT(`BASE_OBJECT.Users__relation`, '$[*].id')
                  //   FROM `AB_AccountingApp_ViewscopeFilterQXCenter`;
                  columnName = `\`${field.alias}.${field.relationName()}\``;
                  operator =
                     condition.rule == "contain_current_user"
                        ? "LIKE"
                        : "NOT LIKE";
                  value = `'%${userData.username}%'`;
               }
               // Object
               else {
                  columnName = `${this.object.dbTableName()}.${this.object.PK()}`;
                  operator =
                     condition.rule == "contain_current_user" ? "IN" : "NOT IN";
                  value = `(SELECT \`${this.object.name}\`
                           FROM \`${field.joinTableName()}\`
                           WHERE \`USER\` IN ('${userData.username}'))`;
               }
            }
            break;

         case "is_null":
            operator = "IS NULL";
            value = "";
            break;

         case "is_not_null":
            operator = "IS NOT NULL";
            value = "";
            break;

         case "in":
            operator = "IN";

            // If condition.value is MySQL query command - (SELECT .. FROM ?)
            if (
               typeof condition.value == "string" &&
               RegExp("^[(].*[)]$").test(condition.value)
            ) {
               value = condition.value;
            }
            // if we wanted an IN clause, but there were no values sent, then we
            // want to make sure this condition doesn't return anything
            else if (
               Array.isArray(condition.value) &&
               condition.value.length > 0
            ) {
               value =
                  "(" +
                  condition.value
                     .map(function (v) {
                        return quoteMe(v);
                     })
                     .join(", ") +
                  ")";
            } else {
               // send a false by resetting the whereRaw to a fixed value.
               // any future attempts to replace this will be ignored.
               whereRaw = " 1=0 ";
            }
            break;

         case "not_in":
            operator = "NOT IN";

            // If condition.value is MySQL query command - (SELECT .. FROM ?)
            if (
               typeof condition.value == "string" &&
               RegExp("^[(].*[)]$").test(condition.value)
            ) {
               value = condition.value;
            }
            // if we wanted a NOT IN clause, but there were no values sent, then we
            // want to make sure this condition returns everything (not filtered)
            else if (
               Array.isArray(condition.value) &&
               condition.value.length > 0
            ) {
               value =
                  "(" +
                  condition.value
                     .map(function (v) {
                        return quoteMe(v);
                     })
                     .join(", ") +
                  ")";
            } else {
               // send a TRUE value so nothing gets filtered
               whereRaw = " 1=1 ";
            }
            break;
         case "greater_current":
         case "greater_or_equal_current":
         case "less_current":
         case "less_or_equal_current":
            switch (field?.key) {
               case "date":
                  value = `TO_DATE('${
                     new Date().toISOString().split("T")[0]
                  }', 'YYYY-MM-DD')`;
                  break;
               case "datetime":
                  value = `TO_TIMESTAMP('${new Date().toISOString()}', 'YYYY-MM-DDTHH24:MI:SS')`;
                  break;
               default:
                  break;
            }
            break;
         case "last_days":
            value = `DATE_SUB(NOW(), INTERVAL ${condition.value} DAY) AND NOW()`;
            break;
         case "next_days":
            value = `NOW() AND DATE_ADD(NOW(), INTERVAL ${condition.value} DAY)`;
            break;
         case "is_current_date":
            operator = "BETWEEN";
            var datetimerange = this.AB.rules.getUTCDayTimeRange().split("|");
            value = `"${datetimerange[0]}" AND "${datetimerange[1]}"`;
            break;
         case "is_empty":
         case "is_not_empty":
            // returns NULL if they are equal. Otherwise, the first expression is returned.
            columnName = `NULLIF(${columnName}, '')`;
            value = "";
            break;

         case "checked":
         case "unchecked":
            value = "";
            break;
      }

      // update our where statement:
      if (columnName && operator) {
         whereRaw = whereRaw
            .replace("{fieldName}", columnName)
            .replace("{operator}", operator)
            .replace("{input}", value != null ? value : "");

         return whereRaw;
      }
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
            console.log("TODO: decode SECRET here");
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
         req.log(msg, err.response?.status, err.response?.data, err.q);
      }

      let message = "Rejected by NetSuite. ";
      if (err.response?.data["o:errorDetails"]) {
         message += err.response.data["o:errorDetails"][0].detail;
      }
      throw new Error(message);
   }

   /**
    * @method toNetsuiteBool()
    * this method changes the values in place to match what Netsuite wants
    * for their create/update operations.
    * @param {json} baseValues
    *        the data we are sending TO Netsuite
    * @return undefined
    */
   toNetsuiteBool(baseValues) {
      // Boolean Fields
      // in our AB system, we use 1/0 for true/false values.  Netsuite will
      // want those as true/false.

      let boolFields = this.object.fields((f) => f.key == "boolean");
      for (let i = 0; i < boolFields.length; i++) {
         let bF = boolFields[i];
         if (typeof baseValues[bF.columnName] != "undefined") {
            let val = baseValues[bF.columnName];
            if (typeof val == "string") val = val.toLowerCase();
            if (TruthyValues.indexOf(val) > -1) {
               baseValues[bF.columnName] = true;
            } else {
               baseValues[bF.columnName] = false;
            }
         }
      }
   }

   /**
    * @method fromNetsuiteBool()
    * this method changes the values in place to match what our Framework expects
    * for our boolean values.
    * @param {array} data
    *        the data we are receiving FROM Netsuite
    * @return undefined
    */
   fromNetsuiteBool(data) {
      // Boolean Fields
      let boolFields = this.object.fields((f) => f.key == "boolean");
      for (let d = 0; d < data.length; d++) {
         let row = data[d];

         for (let i = 0; i < boolFields.length; i++) {
            let bF = boolFields[i];
            if (typeof row[bF.columnName] != "undefined") {
               let val = row[bF.columnName];
               if (typeof val == "string") val = val.toLowerCase();
               if (TruthyValues.indexOf(val) > -1) {
                  row[bF.columnName] = 1;
               } else {
                  row[bF.columnName] = 0;
               }
            }
         }
      }
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

      // Boolean Fields
      // in our AB system, we use 1/0 for true/false values.  Netsuite will
      // want those as true/false.
      this.toNetsuiteBool(baseValues);

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
         response = await fetchConcurrent(
            this.AB,
            this.credentials,
            url,
            "POST",
            baseValues
         );
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
         let response = await fetchConcurrent(
            this.AB,
            this.credentials,
            url,
            "DELETE"
         );
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

      if (typeof values == "undefined") values = [];

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

      let response = await fetchConcurrent(
         this.AB,
         this.credentials,
         URL,
         "POST",
         {
            q: sql,
         },
         { Prefer: "transient" }
      );

      let list = response.data.items;

      // workaround: remove any inactive entries
      if (field.settings.joinActiveField) {
         let val = field.settings.joinActiveValue;
         list = list.filter(
            (o) =>
               o[field.settings.joinActiveField] == val ||
               o[field.settings.joinActiveField.toLowerCase()] == val
         );
      }

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

         let responseLinkObj = await fetchConcurrent(
            this.AB,
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
      if (cond.offset) {
         if (qs) qs += "&";
         qs = `${qs}offset=${cond.offset}`;
      }
      if (qs) qs = `?${qs}`;

      let URL = `${this.credentials.NETSUITE_QUERY_BASE_URL}/suiteql${qs}`;

      // first, pull out our "have_no_relation" rules for later:
      var noRelationRules = [];
      cond.where = this.queryConditionsPluckRelationConditions(
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
         let response = await fetchConcurrent(
            this.AB,
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
         this.normalizeData(list);
         return list;
      } catch (err) {
         err.q = sql;
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
    * @param {obj} baseValues
    *        the non connection field values for this entry. (we need this
    *        for accessing the entity value in many:many rships)
    * @param {ABUtils.req} req
    */
   async synchronizeRelationValues(id, values, baseValues, req) {
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
            allColumns.push(
               this.syncColumnManyMany(id, field, colVals, baseValues, req)
            );
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
      let response = await fetchConcurrent(
         this.AB,
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
            allUpdates.push(
               fetchConcurrent(this.AB, this.credentials, url, "PATCH", setVal)
            );
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

   async syncColumnManyMany(id, field, values, baseValues, req) {
      let URL = `${this.credentials.NETSUITE_QUERY_BASE_URL}/suiteql`;

      let sql = `SELECT * FROM ${field.settings.joinTable} `;

      let cond = [];
      // set initial myPK condition
      cond.push(`${field.settings.joinTableReference}=${id}`);

      //// MAJOR HEADACHE:
      //// I have been working on figuring out how Netsuite handles
      //// Boolean values in SQL: SELECT ... WHERE boolField = false|0
      //// I've tried using:
      //// boolField = false
      //// boolField = f
      //// boolFiled = 0    <--- this worked once, I think
      //// NOT boolField
      ////
      //// However nothing has worked consistently.  I keep getting
      //// error messages back.

      // // if this joinTable has an active/inactive fields,
      // // then push the active cond
      // if (field.settings.joinActiveField) {
      //    let val = field.settings.joinActiveValue.toLowerCase();
      //    if (["1", "t", "true"].indexOf(val) > -1) {
      //       val = true;
      //       val = 1;
      //    } else {
      //       val = false;
      //       val = 0;
      //    }
      //    cond.push(`${field.settings.joinActiveField}=${val}`);
      // }

      //// Workaround: we will get all the rows, and filter out the
      //// false values manually:

      // now combine the full SQL here
      sql = `${sql} WHERE ${cond.join(" AND ")}`;

      if (req) {
         req.log(sql);
         req.performance.mark(`${field.columnName}-lookup`);
      }
      // first get the old values:
      let response = await fetchConcurrent(
         this.AB,
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

      //// workaround: manually filter out the inactive values:
      if (field.settings.joinActiveField) {
         let val = field.settings.joinActiveValue;
         oldValues = oldValues.filter(
            (o) =>
               o[field.settings.joinActiveField] == val ||
               o[field.settings.joinActiveField.toLowerCase()] == val
         );
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

      addDrop.push(this.relateMany(id, field, values, baseValues, req));
      addDrop.push(this.unRelateMany(id, field, removeThese, req));

      await Promise.all(addDrop);
   }

   async relateMany(id, field, values, baseValues, req) {
      if (values.length == 0) return;

      let url = `${this.credentials.NETSUITE_BASE_URL}/${field.settings.joinTable}`;

      let linkField = field.fieldLink;

      let allRelates = [];
      let parallelCount = 0;
      for (let i = 0; i < values.length; i++) {
         let v = values[i];

         // // subsidary: {id: XXX}. format
         // let newVal = {};
         // let fieldVal = {};
         // fieldVal[field.object.PK()] = `${id}`;
         // newVal[field.settings.joinTableReference] = fieldVal;
         // let linkVal = {};
         // linkVal[linkField.object.PK()] = `${v}`;
         // newVal[linkField.settings.joinTableReference] = linkVal;

         let newVal = {};
         newVal[field.settings.joinTableReference] = id;
         newVal[linkField.settings.joinTableReference] = v;

         if (field.settings.joinActiveField) {
            let val = field.settings.joinActiveValue.toLowerCase();
            if (TruthyValues.indexOf(val) > -1) {
               val = true;
            } else {
               val = false;
            }
            newVal[field.settings.joinActiveField] = val;
         }

         // find the Entity Field on this Object so we can set the Entity value
         // on the connection:
         let thisEntityField = this.object.connectFields((f) => {
            // does this field connect to an Object that has tablename "subsidary"
            if (f.datasourceLink.tableName == "subsidiary") {
               return true;
            }
            return false;
         })[0];

         let entityValue = baseValues[thisEntityField?.columnName];
         if (!entityValue) {
            let errorMissingEntity = new Error(
               "Could not find Entity value to make many:many joins"
            );
            if (req) {
               req.log(errorMissingEntity);
            }
            throw errorMissingEntity;
         }
         newVal[field.settings.joinTableEntity] = entityValue;

         if (req) {
            req.log("relateMany:");
            req.log(url);
            req.log(newVal);
         }
         allRelates.push(
            fetchConcurrent(this.AB, this.credentials, url, "POST", newVal)
         );

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

      // Workaround:  manually filter the inactive values
      // if (field.settings.joinActiveField) {
      //    conditions.push(
      //       `${field.settings.joinActiveField}=${field.settings.joinActiveValue}`
      //    );
      // }

      sql = `${sql} WHERE ${conditions.join(" AND ")}`;

      let response = await fetchConcurrent(
         this.AB,
         this.credentials,
         URL,
         "POST",
         {
            q: sql,
         },
         { Prefer: "transient" }
      );

      let oldValues = response.data.items;

      // workaround: manually filter the inactive values
      if (field.settings.joinActiveField) {
         let val = field.settings.joinActiveValue;
         oldValues = oldValues.filter(
            (o) =>
               o[field.settings.joinActiveField] == val ||
               o[field.settings.joinActiveField.toLowerCase()] == val
         );
      }

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

      let val = false;
      if (
         TruthyValues.indexOf(field.settings.joinInActiveValue.toLowerCase()) >
         -1
      ) {
         val = true;
      }
      updateValue[field.settings.joinActiveField] = val;

      if (req) {
         req.performance.mark("update-unrelate-many");
      }

      let allUnRelates = [];
      let parallelCount = 0;
      for (let i = 0; i < pks.length; i++) {
         allUnRelates.push(
            await fetchConcurrent(
               this.AB,
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
            await fetchConcurrent(
               this.AB,
               this.credentials,
               `${url}${pks[i]}`,
               "DELETE"
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

      // let transParams = this.AB.cloneDeep(baseValues.translations);
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

      // Boolean Fields
      // in our AB system, we use 1/0 for true/false values.  Netsuite will
      // want those as true/false.
      this.toNetsuiteBool(baseValues);

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
         await fetchConcurrent(
            this.AB,
            this.credentials,
            url,
            "PATCH",
            baseValues
         );
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

      await this.synchronizeRelationValues(
         id,
         updateRelationParams,
         baseValues,
         req
      );

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

      where = this.queryConditionsPluckRelationConditions(
         where,
         noRelationRules
      );

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

   normalizeData(data) {
      super.normalizeData(data);
      this.fromNetsuiteBool(data);
   }
};
