import assert from "node:assert/strict";
import test from "node:test";
import {
  createGhostClawGate,
  inspectStandardX402Requirement,
} from "./index.mjs";

test("merchant gate returns a deterministic GhostClaw requirement and imports verified settlement", async () => {
  const merchant = "0x4444444444444444444444444444444444444444";
  let imported = null;
  const gate = createGhostClawGate({
    price: "2.5",
    merchant,
    noteEncryptionPublicKey: "B".repeat(64),
    facilitatorUrl: "https://facilitator.example/ghostclaw/",
    fetchImpl: async (url, init) => {
      assert.equal(String(url), "https://facilitator.example/ghostclaw/verify");
      const input = JSON.parse(init.body);
      assert.equal(input.merchant, merchant);
      assert.equal(input.paymentRequired, undefined);
      assert.equal(input.paymentSignature, "paid-response");
      return Response.json({
        status: "settled",
        scheme: "ghostclaw-confidential-x402-v2",
        verification: "public-chain",
        merchant,
        transactionHash: `0x${"45".repeat(32)}`,
      });
    },
    onSettlement: async (value) => { imported = value; },
  });
  const unpaid = await gate({ url: "https://merchant.example/report", headers: {} });
  const repeat = await gate({ url: "https://merchant.example/report", headers: {} });
  assert.equal(unpaid.status, 402);
  assert.equal(unpaid.headers["payment-required"], repeat.headers["payment-required"]);
  const paid = await gate({
    url: "https://merchant.example/report",
    headers: { "payment-signature": "paid-response" },
  });
  assert.equal(paid.paid, true);
  assert.equal(imported.settlement.transactionHash, `0x${"45".repeat(32)}`);
});

test("a standard exact endpoint exposes the transfer amount and is not confidential-compatible", () => {
  assert.deepEqual(inspectStandardX402Requirement({ accepts: [{ scheme: "exact" }] }), {
    standardExact: true,
    compatible: false,
    reason: "standard-exact-requires-public-token-transfer",
    publicFields: ["payer", "merchant", "asset", "amount", "transaction-time"],
  });
});

test("merchant middleware can load its identity and import the note through the local wallet", async () => {
  const merchant = "0x5555555555555555555555555555555555555555";
  let imported = null;
  const gate = createGhostClawGate({
    price: "1",
    facilitatorUrl: "https://facilitator.example/ghostclaw/",
    localMerchantIdentity: async () => ({
      merchant,
      noteEncryptionPublicKey: "C".repeat(64),
    }),
    fetchImpl: async () => Response.json({
      status: "settled",
      scheme: "ghostclaw-confidential-x402-v2",
      verification: "public-chain",
      merchant,
      transactionHash: `0x${"56".repeat(32)}`,
    }),
    importSettlement: async (value) => { imported = value; },
  });
  const unpaid = await gate({ url: "https://merchant.example/data", headers: {} });
  const paid = await gate({
    url: "https://merchant.example/data",
    headers: { "payment-signature": "settlement" },
  });
  assert.equal(unpaid.status, 402);
  assert.equal(paid.paid, true);
  assert.equal(imported.paymentSignature, "settlement");
});
