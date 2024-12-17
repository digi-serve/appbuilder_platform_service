/**
 * ABModelConvertIsUserMNConditions
 *
 * @module      :: Policy
 * @description :: Scan any provided conditions to see if we have a 'is_current_user'
 *                 or 'not_is_current_user' clause that references a connection that is
 *                 many:many.  If we do, convert it to an IN or NOT IN clause.
 *
 * @docs        :: http://sailsjs.org/#!documentation/policies
 *
 */

module.exports = function (AB, where, object, userData, next, req) {
   // our QB Conditions look like:
   // {
   //   "glue": "and",
   //   "rules": [{
   //     "key": "name_first",
   //     "rule": "begins_with",
   //     "value": "a"
   //   }, {
   //     "key": "name_family",
   //     "rule": "begins_with",
   //     "value": "a"
   //   }, {
   //     "glue": "or",
   //     "rules": [{
   //       "glue": "and",
   //       "rules": [{
   //         "key": "name_first",
   //         "rule": "not_begins_with",
   //         "value": "Apple"
   //       }, {
   //         "key": "name_family",
   //         "rule": "not_contains",
   //         "value": "Pie"
   //       }]
   //     }, {
   //       "glue": "and",
   //       "rules": [{
   //         "key": "name_first",
   //         "rule": "ends_with",
   //         "value": "Crumble"
   //       }, {
   //         "key": "name_family",
   //         "rule": "equal",
   //         "value": "Goodness"
   //       }]
   //     }]
   //   }]
   // }
   //
   //

   // move along if no or empty where clause
   if (AB.isEmpty(where)) {
      next();
      return;
   }

   parseCondition(
      AB,
      where,
      object,
      userData,
      (err) => {
         next(err);
      },
      req
   );
};

/**
 * @function findEntry
 * analyze the current condition to see if it is one we are looking for.
 * if it is a grouping entry ( 'and', 'or') then search it's children looking
 * for an entry as well.
 * if no entry is found, return null.
 * @param {obj} a condition entry
 * @return {obj} a condition entry that matches our type we are looking for:
 */
function findEntry(_where, object) {
   if (!_where) return null;

   if (_where.rules) {
      var entry = null;
      for (var i = 0; i < _where.rules.length; i++) {
         entry = findEntry(_where.rules[i], object);
         if (entry) {
            return entry;
            // break;
         }
      }
      return entry;
   } else {
      if (
         _where.rule == "is_current_user" ||
         _where.rule == "is_not_current_user"
      ) {
         let field = object.fieldByID(_where.key);
         if (field) {
            let link = `${field.linkType()}:${field.linkViaType()}`;
            if (link == "many:many") {
               return _where;
            }
         }
      }
      return null;
   }
}

function parseCondition(AB, where, object, userData, cb, req) {
   var cond = findEntry(where, object);
   if (!cond) {
      cb();
   } else {
      let field = object.fieldByID(cond.key);
      if (!field) {
         var error = AB.toError("improperly formed lookup.", {
            location: "ABModelConvertIsUserMNConditions",
            cond,
         });
         cb(error);
         return;
      }

      /// now we just change this to
      cond.rule = cond.rule == "is_current_user" ? "in" : "not_in";
      cond.value = [userData.username];

      parseCondition(AB, where, object, userData, cb, req);
   } // if !cond
}
