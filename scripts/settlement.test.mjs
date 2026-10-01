import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { encodeCallsMAv2 } from "@alchemy/smart-accounts";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  getAddress,
  toHex,
} from "viem";
import { entryPoint07Abi, entryPoint07Address } from "viem/account-abstraction";
import {
  CONTRACTS,
  NETWORK,
  canonicalRequestDigest,
  poolAbi,
} from "./lib/protocol.mjs";
import { decodeSettlementCall, validatePaymentResponse } from "./lib/settlement.mjs";
import { encryptNote } from "./lib/state.mjs";

const MERCHANT = getAddress("0x3333333333333333333333333333333333333333");
const PAYER = getAddress("0x2222222222222222222222222222222222222222");
const TRANSACTION_HASH = `0x${"44".repeat(32)}`;
const PAYMENT_INTENT = "777";
const TREE_ROOT = "555";
const RECIPIENT_COMMITMENT = "333";
const CHANGE_COMMITMENT = "444";
const REQUEST_SALT = "55".repeat(32);

function paymentFixture(amount = "25000000") {
  const keys = generateKeyPairSync("x25519");
  const note = {
    amount,
    owner: "222",
    blinding: "92",
    commitment: RECIPIENT_COMMITMENT,
    outputPosition: 0,
  };
  const publicKey = keys.publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const privateKey = keys.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
  const noteEnvelope = encryptNote(note, publicKey, MERCHANT, PAYMENT_INTENT);
  const payload = {
    version: 2,
    scheme: "ghostclaw-confidential-x402-v2",
    network: NETWORK,
    merchant: MERCHANT,
    paymentIntent: PAYMENT_INTENT,
    transactionHash: TRANSACTION_HASH,
    requestBindingSalt: REQUEST_SALT,
    noteEnvelope,
  };
  const topics = encodeEventTopics({
    abi: poolAbi,
    eventName: "X402Settlement",
    args: { paymentIntent: 777n, payer: PAYER, merchant: MERCHANT },
  });
  const data = encodeAbiParameters(
    [
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
    ],
    [111n, 222n, 666n, 333n, 444n, 7n, 555n],
  );
  const receipt = {
    status: "success",
    transactionHash: TRANSACTION_HASH,
    blockNumber: 100n,
    logs: [{ address: CONTRACTS.pool, topics, data }],
  };
  const state = {
    owner: "222",
    noteEncryptionPrivateKey: privateKey,
    receivedSettlements: [],
  };
  return { payload, receipt, state, note };
}

function validationOptions(fixture) {
  return {
    payload: fixture.payload,
    state: fixture.state,
    account: MERCHANT,
    canonicalDigest: canonicalRequestDigest(Buffer.from("POST /report/quoted-request")),
    publicClient: {
      getTransactionReceipt: async () => fixture.receipt,
      getTransaction: async () => ({ hash: TRANSACTION_HASH, blockNumber: 100n }),
      getBlockNumber: async () => 101n,
    },
    readPool: async () => true,
    inspectReceivedPayment: async ({ note }) => ({
      recipientCommitment: note.amount === "25000000" ? RECIPIENT_COMMITMENT : "999",
      paymentIntent: note.amount === "25000000" ? PAYMENT_INTENT : "997",
      outputPosition: 0,
    }),
    decodeTransactionSettlement: () => ({
      spendRoot: 1n,
      nullifier: 666n,
      outputLeft: 333n,
      outputRight: 444n,
      recipientOwner: 222n,
      paymentIntent: 777n,
      merchant: MERCHANT,
    }),
  };
}

test("a complete payment response is bound to its transaction and private note", async () => {
  const fixture = paymentFixture();
  const result = await validatePaymentResponse(validationOptions(fixture));
  assert.deepEqual(result.note, fixture.note);
  assert.equal(result.evidence.transactionHash, TRANSACTION_HASH);
  assert.equal(result.evidence.payer, PAYER);
  assert.equal(result.evidence.recipientCommitment, RECIPIENT_COMMITMENT);
});

test("the fabricated merchant-note amount exploit is rejected", async () => {
  const fixture = paymentFixture("90000000");
  await assert.rejects(
    validatePaymentResponse(validationOptions(fixture)),
    /private note does not match the settled payment call/,
  );
});

test("bare note envelopes and replayed settlement evidence are rejected", async () => {
  const fixture = paymentFixture();
  await assert.rejects(
    validatePaymentResponse({ ...validationOptions(fixture), payload: fixture.payload.noteEnvelope }),
    /complete GhostClaw payment response/,
  );
  fixture.state.receivedSettlements.push({
    paymentIntent: PAYMENT_INTENT,
    transactionHash: TRANSACTION_HASH,
    requestBindingSalt: REQUEST_SALT,
  });
  await assert.rejects(
    validatePaymentResponse(validationOptions(fixture)),
    /already accepted/,
  );
});

test("the merchant decodes the exact confidential transfer from EntryPoint calldata", () => {
  const proof = `0x${"11".repeat(768)}`;
  const transfer = {
    to: CONTRACTS.pool,
    value: 0n,
    data: encodeFunctionData({
      abi: poolAbi,
      functionName: "confidentialTransfer",
      args: [proof, 1n, 666n, 333n, 444n, 222n, 777n, MERCHANT],
    }),
  };
  const operation = {
    sender: PAYER,
    nonce: 0n,
    initCode: "0x",
    callData: encodeCallsMAv2([transfer]),
    accountGasLimits: toHex(0, { size: 32 }),
    preVerificationGas: 0n,
    gasFees: toHex(0, { size: 32 }),
    paymasterAndData: "0x",
    signature: "0x",
  };
  const input = encodeFunctionData({
    abi: entryPoint07Abi,
    functionName: "handleOps",
    args: [[operation], PAYER],
  });
  const decoded = decodeSettlementCall({
    to: entryPoint07Address,
    chainId: 84532,
    input,
  }, PAYER);
  assert.equal(decoded.outputLeft, 333n);
  assert.equal(decoded.outputRight, 444n);
  assert.equal(decoded.paymentIntent, 777n);
  assert.equal(decoded.merchant, MERCHANT);
});
