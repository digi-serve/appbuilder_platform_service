const crypto = require("crypto");

// Encryption settings
const CRYPTO_ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;

class SecretManager {
   async init(AB) {
      this.secret = AB.objectSecret().model();
      this.key = AB.objectKey().model();
   }

   /**
    * Retrieves a saved private key for a given definition. Will create and save
    * one if it does not exist.
    * @param {string} definitionID unique id of the definition the key is for
    * @resolves {string} private key
    */
   async _getKey(definitionID) {
      const cacheKey = `_cachePK_${definitionID}`;
      if (!this[cacheKey]) {
         // this[cacheKey] is promise to avoid looking up / creating multiple
         // times. it will resolve with the key
         this[cacheKey] = (async () => {
            // Check if the database has one
            const [key] =
               (await this.key.find({
                  where: { DefinitionID: definitionID },
                  limit: 1,
               })) ?? [];
            if (key) return key.Key;
            // If not we'll create one
            const newKey = crypto.randomBytes(KEY_LENGTH).toString("hex");
            await this.key.create({
               Key: newKey,
               DefinitionID: definitionID,
            });
            return newKey;
         })();

         // We don't want to cache these keys in memory for a long time, but also
         // don't want to read from the database each time. One defintion might
         // have multiple secrets that will be read or written within a few
         // seconds. So we'll cache it, but also schedule a cleanup in 5 mins.
         const cacheCleanup = `${cacheKey}_cleanup`;
         clearTimeout(this[cacheCleanup]);
         this[cacheCleanup] = setTimeout(async () => {
            await this[cacheKey];
            delete this[cacheKey];
            delete this[cacheCleanup];
         }, 5 * 60 * 1000);
      }
      return await this[cacheKey];
   }

   /**
    * Deletes a secret from the database
    */
   delete(definitionID, name) {
      return this.secret
         .find({
            where: {
               DefinitionID: definitionID,
               Name: name,
            },
            limit: 1,
         })
         .then((result) => {
            const toDelete = result?.[0]?.uuid;
            if (toDelete) this.secret.delete(toDelete);
         });
   }

   /**
    * Encyrpts and stores a secret value
    * @param {string} defintionID - unique id of the definition this secret
    * belongs to
    * @param {object} secret any number of secrets to add
    * @param {string} secret.name to refernce this secret by
    * @param {string} secret.value the secret to be encrypted
    */
   async create(defintionID, ...secrets) {
      const pk = await this._getKey(defintionID);
      const saves = secrets.map(({ name, value }) => {
         // Encrypt
         const encryptedValue = this._encrypt(pk, value);

         // Save to DB
         return this.secret.create({
            Name: name,
            Secret: encryptedValue,
            DefinitionID: defintionID,
         });
      });
      await Promise.all(saves);
   }

   /**
    * Retrieve and decrypt a stored secret
    * @param {string} defintionID - unique id of the definition the secret
    * belongs to
    * @param {string} name of the secret
    */
   async getValue(definitionID, name) {
      const pk = await this._getKey(definitionID);

      // Lookup the secret from the DB
      const list = await this.secret.find({
         where: {
            DefinitionID: definitionID,
            Name: name,
         },
         limit: 1,
      });
      const secret = list?.[0]?.Secret ?? "";
      if (!secret) return null;

      return this._decrypt(pk, secret);
   }

   /**
    * get a list of sotred secret names for a given definition
    */
   async getStoredNames(definitionID) {
      // Lookup the secrets from the DB
      const list = await this.secret.find({
         where: {
            DefinitionID: definitionID,
         },
      });
      return list?.map?.((secret) => secret.Name);
   }

   _encrypt(pk, value) {
      const iv = crypto.randomBytes(IV_LENGTH);
      const cipher = crypto.createCipheriv(
         CRYPTO_ALGORITHM,
         Buffer.from(pk, "hex"),
         iv
      );
      const encrypted = cipher.update(Buffer.from(value, "utf-8"));
      cipher.final();
      const encryptedValue = Buffer.concat([
         encrypted,
         iv,
         cipher.getAuthTag(),
      ]).toString("hex");

      return encryptedValue;
   }

   _decrypt(pk, encrypted) {
      const encryptedBuffer = Buffer.from(encrypted, "hex");
      const bufferLength = encryptedBuffer.length;
      const diff = bufferLength - IV_LENGTH;
      const text = encryptedBuffer.subarray(0, diff * 2);
      const iv = encryptedBuffer.subarray(diff * 2, diff);
      const authTag = encryptedBuffer.subarray(diff, bufferLength);
      const decipher = crypto.createDecipheriv(
         CRYPTO_ALGORITHM,
         Buffer.from(pk, "hex"),
         iv
      );
      decipher.setAuthTag(authTag);
      let decrypted = decipher.update(text);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      return decrypted.toString("utf-8");
   }
}

module.exports = SecretManager;
