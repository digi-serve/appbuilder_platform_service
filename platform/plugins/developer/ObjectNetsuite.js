module.export = function FNObjectNetsuite({ /*AB,*/ ABObjectPlugin }) {
   return class ABObjectNetsuiteAPI extends ABObjectPlugin {
      constructor(...params) {
         super(...params);
         console.log("ABObjectNetsuiteAPI  BABY!!!!");
      }
      static getPluginKey() {
         return "ab-object-netsuite-api";
      }
   };
};
