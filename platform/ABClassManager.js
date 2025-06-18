const ABObjectPlugin = require("./plugins/ABObjectPlugin.js");
// import { ABObjectPlugin } from './plugins/ABObjectPlugin.js';
// import { ABObjectPropertiesPlugin } from './plugins/ABObjectPropertiesPlugin.js';
// import { ABFieldPlugin } from './ABFieldPlugin.js';
// import { ABViewPlugin } from './ABViewPlugin.js';

const classRegistry = {
   ObjectTypes: new Map(),
   ObjectPropertiesTypes: new Map(),
   FieldTypes: new Map(),
   ViewTypes: new Map(),
};

function getPluginAPI() {
   return {
      ABObjectPlugin,
      // ABObjectPropertiesPlugin,
      //  ABFieldPlugin,
      //  ABViewPlugin,
      registerObjectType: (name, ctor) =>
         classRegistry.ObjectTypes.set(name, ctor),
      // registerObjectPropertyType: (name, ctor) => classRegistry.ObjectPropertiesTypes.set(name, ctor),
      //  registerFieldType: (name, ctor) => classRegistry.FieldTypes.set(name, ctor),
      //  registerViewType: (name, ctor) => classRegistry.ViewTypes.set(name, ctor),
   };
}

// export function createField(type, config) {
//   const FieldClass = classRegistry.FieldTypes.get(type);
//   if (!FieldClass) throw new Error(`Unknown object type: ${type}`);
//   return new FieldClass(config);
// }

function createObject(key, config, AB) {
   const ObjectClass = classRegistry.ObjectTypes.get(key);
   if (!ObjectClass) throw new Error(`Unknown object type: ${key}`);
   return new ObjectClass(config, AB);
}

// export function createObjectProperty(key, config) {
//    const ObjectClass = classRegistry.ObjectPropertiesTypes.get(key);
//    if (!ObjectClass) throw new Error(`Unknown object type: ${key}`);
//    return new ObjectClass(config);
//  }

// export function createView(type, config) {
//   const ViewClass = classRegistry.ViewTypes.get(type);
//   if (!ViewClass) throw new Error(`Unknown object type: ${type}`);
//   return new ViewClass(config);
// }

///
/// For development
///
let devPlugins = [require("./plugins/developer/ObjectNetsuite.js")];

function registerLocalPlugins(API) {
   let { AB, ABObjectPlugin, registerObject } = API;
   devPlugins.forEach((p) => {
      let pluginClass = p(AB, ABObjectPlugin);
      registerObject(pluginClass.getPluginKey(), pluginClass);
   });
}

module.exports = {
   getPluginAPI,
   createObject,
   // createField,
   // createObjectProperty,
   // createView,
   // classRegistry, // Expose the registry for testing or introspection
   registerLocalPlugins,
};
