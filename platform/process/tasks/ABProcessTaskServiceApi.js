const axios = require("axios");
const ApiTaskCore = require("../../../core/process/tasks/ABProcessTaskServiceApiCore");

module.exports = class ApiTask extends ApiTaskCore {
   /**
    * @method do()
    * this method actually performs the action for this task.
    * @param {obj} instance
    *        the instance data of the running process
    * @param {Knex.Transaction?} trx
    *        (optional) Knex Transaction instance.
    * @param {ABUtil.reqService} req
    *        an instance of the current request object for performing tenant
    *        based operations.
    * @return {Promise}
    *        resolve(true/false) : true if the task is completed.
    *                            false if task is still waiting
    */
   async do(instance /*, trx, req */) {
      this.instance = instance;
      const response = await this.request(instance);
      this.stateUpdate(instance, { rawResponse: response.data });
      this.stateCompleted(instance);
   }

   static defaults() {
      return { key: "Api" };
   }

   async request(instance) {
      const [url, headers, data] = await Promise.all([
         this.renderText(this.url, instance),
         this.prepareHeaders(instance),
         this.renderText(this.body, instance),
      ]);

      const opts = {
         url,
         method: this.method,
         headers,
         data: data.replace(/\n/g, ""),
      };

      const response = await axios(opts);

      return response;
   }

   async prepareHeaders(instance) {
      const reqHeaders = {};
      await Promise.all(
         this.headers.map(async (header) => {
            reqHeaders[header.key] = await this.renderText(
               header.value,
               instance,
            );
         }),
      );
      return reqHeaders;
   }

   async renderText(text, instance) {
      if (!text) return "";
      const secretPattern = /<%= Secret: (.+?) %>/g;
      if (secretPattern.test(text)) {
         secretPattern.test(""); // Need to reset the "lastIndex" val of our regex
         const secretNames = [...text.matchAll(secretPattern)].map((m) => m[1]);
         const secrets = {};
         await Promise.all(
            secretNames.map(async (s) => {
               secrets[s] = await this.AB.Secret.getValue(this.id, s);
            }),
         );
         text = text.replace(secretPattern, (_, name) => secrets[name]);
      }
      return text.replace(/<%= (.+?) %>/g, (_, key) => {
         const data = this.process.processData(this, [instance, key]);
         if (data) return data;
         else return "";
      });
   }

   /**
    * @method processData()
    * return the current value requested for the given data key.
    * @param {obj} instance
    * @return {mixed} | null
    */
   processData(instance, key) {
      const [id, param] = (key || "").split(".");
      if (id != this.id) return null;

      const data = this.myState(instance);

      return data[param];
   }
};
