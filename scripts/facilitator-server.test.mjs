import assert from "node:assert/strict";
import test from "node:test";
import { createFacilitatorHandler } from "./lib/facilitator-server.mjs";
import { NETWORK } from "./lib/protocol.mjs";

function encoded(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function responseCapture() {
  return {
    status: null,
    headers: null,
    body: null,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = JSON.parse(body); },
  };
}

test("the hosted facilitator performs a public Base settlement check", async () => {
  const merchant = "0x6666666666666666666666666666666666666666";
  let verified = null;
  const handler = createFacilitatorHandler({
    limiter: {
      preflight: async () => true,
      allow: async () => true,
    },
    validatePublicSettlement: async (input) => {
      verified = input;
      return {
        status: "settled",
        scheme: "ghostclaw-confidential-x402-v2",
        merchant,
        transactionHash: `0x${"78".repeat(32)}`,
      };
    },
  });
  const payment = {
    version: 2,
    scheme: "ghostclaw-confidential-x402-v2",
    network: NETWORK,
    merchant,
    transactionHash: `0x${"78".repeat(32)}`,
  };
  const response = responseCapture();
  await handler({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: { merchant, paymentSignature: encoded(payment) },
  }, response);
  assert.equal(response.status, 200);
  assert.equal(response.body.verification, "public-chain");
  assert.equal(verified.account, merchant);
});

test("the hosted facilitator fails closed for another merchant", async () => {
  const merchant = "0x6666666666666666666666666666666666666666";
  const response = responseCapture();
  await createFacilitatorHandler({
    validatePublicSettlement: async () => { throw new Error("must not run"); },
  })({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: {
      merchant,
      paymentSignature: encoded({ merchant: "0x7777777777777777777777777777777777777777" }),
    },
  }, response);
  assert.equal(response.status, 402);
  assert.deepEqual(response.body, { error: "payment_not_verified" });
});
