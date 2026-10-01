import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { importMerchantSettlement } from "./lib/merchant-wallet.mjs";
import { canonicalRequestDigest } from "./lib/protocol.mjs";

test("a resource retry can reuse one note that the merchant already imported", async () => {
  const privateKey = `0x${"12".repeat(32)}`;
  const account = privateKeyToAccount(privateKey).address;
  const requirementBytes = Buffer.from(JSON.stringify({ quote: "same-private-request" }), "utf8");
  const requestBindingSalt = "34".repeat(32);
  const transactionHash = `0x${"56".repeat(32)}`;
  const state = {
    version: 3,
    transactionSignerMode: "local",
    transactionPrivateKey: privateKey,
    account,
    receivedSettlements: [{
      paymentIntent: "99",
      transactionHash,
      requestBindingSalt,
      canonicalRequestDigest: canonicalRequestDigest(requirementBytes),
      confirmations: 1,
    }],
  };
  const result = await importMerchantSettlement({
    paymentRequiredBase64: requirementBytes.toString("base64"),
    paymentSignature: Buffer.from(JSON.stringify({
      paymentIntent: "99",
      transactionHash,
      requestBindingSalt,
    }), "utf8").toString("base64"),
  }, {
    withWalletLock: async (callback) => callback(),
    loadState: async () => state,
    saveState: async () => { throw new Error("A replay must not change wallet state."); },
  });
  assert.deepEqual(result, {
    status: "already-imported",
    merchant: account,
    paymentIntent: "99",
    transactionHash,
    confirmations: 1,
  });
});
