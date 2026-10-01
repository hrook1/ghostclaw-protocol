import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { bindRequestDigest, canonicalRequestDigest } from "./lib/protocol.mjs";
import { decryptNote, encryptNote, transactionAccount } from "./lib/state.mjs";
import { privateKeyToAccount } from "viem/accounts";

const TRANSACTION_PRIVATE_KEY = `0x${"31".repeat(32)}`;

test("a received note stays encrypted outside the merchant wallet", () => {
  const keys = generateKeyPairSync("x25519");
  const recipient = "0x3333333333333333333333333333333333333333";
  const paymentIntent = "123456789";
  const note = {
    amount: "25000000",
    owner: "91",
    blinding: "92",
    commitment: "93",
    outputPosition: 0,
  };
  const publicKey = keys.publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const privateKey = keys.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
  const envelope = encryptNote(note, publicKey, recipient, paymentIntent);
  assert.doesNotMatch(JSON.stringify(envelope), /25000000/);
  assert.equal(Buffer.from(envelope.ciphertext, "base64").length, 2_048);
  assert.deepEqual(decryptNote(envelope, { noteEncryptionPrivateKey: privateKey }), note);

  const differentLength = encryptNote({ ...note, amount: "1" }, publicKey, recipient, paymentIntent);
  assert.equal(differentLength.ciphertext.length, envelope.ciphertext.length);

  const changed = { ...envelope, recipient: "0x4444444444444444444444444444444444444444" };
  assert.throws(
    () => decryptNote(changed, { noteEncryptionPrivateKey: privateKey }),
    /authenticate data|Unsupported state|unable to authenticate/i,
  );
});

test("a fresh request salt prevents public amount guessing from a predictable request", () => {
  const canonical = canonicalRequestDigest(Buffer.from("GET /report/0x123"));
  const first = bindRequestDigest(canonical);
  const second = bindRequestDigest(canonical);
  assert.match(first.salt, /^[0-9a-f]{64}$/);
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.digest, second.digest);
  assert.deepEqual(bindRequestDigest(canonical, first.salt), first);
});

test("the encrypted transaction key defines the public Base account", () => {
  const account = privateKeyToAccount(TRANSACTION_PRIVATE_KEY).address;
  assert.equal(transactionAccount({
    version: 3,
    account,
    transactionPrivateKey: TRANSACTION_PRIVATE_KEY,
  }), account);
  assert.throws(() => transactionAccount({
    version: 3,
    account: "0x1111111111111111111111111111111111111111",
    transactionPrivateKey: TRANSACTION_PRIVATE_KEY,
  }), /does not match/);
});
