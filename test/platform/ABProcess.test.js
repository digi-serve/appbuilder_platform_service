const assert = require("assert");
const sinon = require("sinon");
const proxyquire = require("proxyquire");

const hash = sinon.fake.returns("hash");
const xml2js = sinon.fake.returns({ test: "test" });

const ABProcess = proxyquire("../../platform/ABProcess", {
   hash,
   convert: { xml2js },
});

const modelResponse = {
   uuid: "uuid",
   hash: "hash",
   definition: '{test:"test"}',
};
const find = sinon.stub();
const create = sinon.fake.resolves(modelResponse);
const mockModel = { find, create };
const mockAB = {
   objectProcessDefinition: () => {
      return {
         model: () => mockModel,
      };
   },
   objectProcessInstance: () => {
      return {
         model: () => mockModel,
      };
   },
};

describe("ABProcess", function () {
   describe("instanceDefinition", function () {
      let process;
      const xmlDefinition = "<test>test</test>";

      beforeEach(function () {
         process = new ABProcess({}, mockAB);
         process.xmlDefinition = xmlDefinition;
         hash.resetHistory();
         xml2js.resetHistory();
         find.resetHistory();
         create.resetHistory();
      });

      it("returns the process definiton", function () {
         find.resolves([modelResponse]);
         process.instanceDefinition().then((result) => {
            assert(hash.calledOnce);
            assert(hash.calledWith(xmlDefinition));
            assert(find.calledOnce);
            assert.deepEqual(find.firstCall.firstArg, { hash: "hash" });
            assert(create.notCalled);
            assert.deepEqual(result, modelResponse);
         });
      });

      it("saves a new process definition", function () {
         find.resolves([]);
         process.instanceDefinition().then((result) => {
            assert(hash.calledOnce);
            assert(hash.calledWith(xmlDefinition));
            assert(find.calledOnce);
            assert.deepEqual(find.firstCall.firstArg, { hash: "hash" });
            assert(create.calledOnce);
            assert.deepEqual(create.firstCall.firstArg, {
               hash: "hash",
               definiton: { test: "test" },
            });
            assert.deepEqual(result, modelResponse);
         });
      });
   });

   describe("instanceNew", function () {
      before(function () {
         find.resolves([modelResponse]);
      });
      beforeEach(function () {
         create.resetHistory();
      });
      it("calls this.instanceDefintion", function () {
         const process = new ABProcess({}, mockAB);
         // const instanceDefintion = sinon.fake.returns(modelResponse);
         sinon.replace(
            process,
            "instanceDefinition",
            sinon.fake.resolves(modelResponse),
         ); //instanceDefinition);
         sinon.replace(process, "run", sinon.fake()); //instanceDefinition);
         process.instanceNew().then(() => {
            assert(process.instanceDefintion.calledOnce);
            assert(process.run.calledOnce);
            assert(create.calledOnce);
            assert.equal(create.firstCall.firstArg.definition, "uuid");
            assert.deepEqual(
               process.run.firstCall.firstArg.jsonDefinition,
               modelResponse,
            );
         });
      });
   });
});
