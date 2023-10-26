const crypto = require("crypto");

const ABObjectApiCore = require("../core/ABObjectApiCore");

const CRYPTO_ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const VI_LENGTH = 16;

module.exports = class ABObjectApi extends ABObjectApiCore {
   /**
    * migrateCreate
    * verify that a table for this object exists.
    * @param {ABUtil.reqService} req
    *        the request object for the job driving the migrateCreate().
    * @param {knex} knex
    *        the Knex connection.
    * @return {Promise}
    */
   async migrateCreate(req, knex) {
      const createTasks = [];
      const modelKey = this.AB.objectKey().model();
      const modelSecret = this.AB.objectSecret().model();

      // Create/Store the key of the API Object
      const privateKey = this._createPrivateKey();
      createTasks.push(
         modelKey.create({
            Key: privateKey,
            DefinitionID: this.id,
         })
      );

      // Encrypt/Store secrets of the API Object
      (this.secrets ?? []).forEach((secret) => {
         const encrypted = this._encryptSecret(privateKey, secret.value);

         createTasks.push(
            modelSecret.create({
               Name: secret.name,
               Secret: encrypted,
               DefinitionID: this.id,
            })
         );
      });

      return Promise.all(createTasks);
   }

   _createPrivateKey() {
      const key = crypto.randomBytes(KEY_LENGTH);

      return key.toString("hex");
   }

   async _getPrivateKey() {}

   _encryptSecret(key, text) {
      const iv = crypto.randomBytes(VI_LENGTH);
      const cipher = crypto.createCipheriv(
         CRYPTO_ALGORITHM,
         Buffer.from(key, "hex"),
         iv
      );

      const encrypted = cipher.update(Buffer.from(text, "utf-8"));
      cipher.final();

      return Buffer.concat([encrypted, iv, cipher.getAuthTag()]).toString(
         "hex"
      );
   }

   _decryptSecret(key, encrypted) {
      const encryptedBuffer = Buffer.from(encrypted, "hex");
      const text = encryptedBuffer.slice(
         0,
         encryptedBuffer.length - VI_LENGTH * 2
      );
      const vi = encryptedBuffer.slice(
         encryptedBuffer.length - VI_LENGTH * 2,
         encryptedBuffer.length - VI_LENGTH
      );
      const authTag = encryptedBuffer.slice(
         encryptedBuffer.length - VI_LENGTH,
         encryptedBuffer.length
      );

      const decipher = crypto.createDecipheriv(
         CRYPTO_ALGORITHM,
         Buffer.from(key, "hex"),
         vi
      );
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(text);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      return decrypted.toString("utf-8");
   }
};

