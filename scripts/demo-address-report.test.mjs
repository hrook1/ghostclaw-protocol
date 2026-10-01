import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  buildAddressReport,
  createAddressReportHandler,
  DemoReportStore,
} from "./lib/demo-address-report.mjs";
import { DemoMerchantStateStore } from "./lib/demo-merchant-store.mjs";
import { loadDemoMerchantDeployment, publicDemoMerchantDeployment } from "./lib/demo-merchant-deployment.mjs";
import { createVercelAddressReportHandler, handleVercelAddressReport } from "./lib/vercel-demo-address-report.mjs";
import { newHostedSecret, openSealedJson, sealJson } from "./lib/sealed-json.mjs";
import { UpstashStore } from "./lib/upstash-store.mjs";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const MERCHANT = "0x2222222222222222222222222222222222222222";
const TRANSACTION = `0x${"33".repeat(32)}`;

class MemoryRedis {
  constructor() { this.values = new Map(); }
  async get(key) { return this.values.get(key) ?? null; }
  async set(key, value, options = {}) {
    if (options.nx && this.values.has(key)) return null;
    this.values.set(key, value);
    return "OK";
  }
  async eval(_script, keys, args) {
    if (this.values.get(keys[0]) === args[0]) {
      this.values.delete(keys[0]);
      return 1;
    }
    return 0;
  }
}

function responseCapture() {
  return {
    status: null,
    headers: null,
    text: null,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.text = body; },
    json() { return JSON.parse(this.text); },
  };
}

function deploymentFixture() {
  const secret = newHostedSecret();
  const pair = generateKeyPairSync("x25519");
  const transactionPrivateKey = generatePrivateKey();
  const merchant = privateKeyToAccount(transactionPrivateKey).address;
  const state = {
    version: 3,
    keySet: "ab".repeat(16),
    spendKey: "1234",
    owner: "5678",
    account: merchant,
    transactionSignerMode: "local",
    transactionPrivateKey,
    noteEncryptionPrivateKey: pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    noteEncryptionPublicKey: pair.publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    notes: [],
    history: [],
    receivedSettlements: [],
  };
  const deployment = {
    version: 1,
    status: "live-testnet-only",
    network: "base-sepolia",
    merchant,
    owner: state.owner,
    noteEncryptionPublicKey: state.noteEncryptionPublicKey,
    registeredAt: "2026-08-01T00:00:00.000Z",
    registrationTransactionHash: TRANSACTION,
    sealedState: sealJson(state, secret, {
      purpose: "demo-merchant-state",
      aad: `ghostclaw-demo-merchant-state-v1:${merchant.toLowerCase()}`,
    }),
  };
  return { secret, state, deployment, publicDeployment: publicDemoMerchantDeployment(deployment) };
}

test("the hosted deployment loader authenticates a secret seed against the public manifest", async () => {
  const fixture = deploymentFixture();
  assert.deepEqual(Object.keys(fixture.publicDeployment), [
    "version", "status", "network", "merchant", "owner", "noteEncryptionPublicKey",
    "registeredAt", "registrationTransactionHash",
  ]);
  assert.equal("sealedState" in fixture.publicDeployment, false);
  const loaded = loadDemoMerchantDeployment(fixture.publicDeployment, {
    GHOSTCLAW_DEMO_MERCHANT_DEPLOYMENT_JSON: JSON.stringify(fixture.deployment),
    GHOSTCLAW_DEMO_MERCHANT_SECRET: fixture.secret,
  });
  assert.deepEqual(loaded, fixture.deployment);

  const redis = new MemoryRedis();
  const store = new DemoMerchantStateStore({ redis, secret: fixture.secret, deployment: loaded });
  const receivedState = { ...fixture.state, notes: [{ commitment: "9" }] };
  await store.saveState(receivedState);
  assert.deepEqual((await store.loadState()).notes, receivedState.notes);

  const handler = createVercelAddressReportHandler(loaded, {
    secret: fixture.secret,
    redis,
    rateLimit: {},
    limiter: { preflight: async () => true },
    createGate: () => async () => { throw new Error("The status route must not authorize a payment."); },
  });
  const response = responseCapture();
  await handler({
    method: "GET",
    url: "/demo/address-report?status=1",
    headers: { host: "merchant.example", "x-forwarded-proto": "https" },
  }, response);
  assert.equal(response.status, 200);
  assert.equal(response.json().merchant, fixture.publicDeployment.merchant);
});

test("the hosted deployment loader rejects each public identity or registration mismatch", () => {
  const fixture = deploymentFixture();
  const changes = {
    version: 2,
    status: "production",
    network: "base",
    merchant: ADDRESS,
    owner: "6789",
    noteEncryptionPublicKey: "different-key",
    registeredAt: "2026-08-02T00:00:00.000Z",
    registrationTransactionHash: `0x${"44".repeat(32)}`,
  };
  for (const [key, value] of Object.entries(changes)) {
    assert.throws(() => loadDemoMerchantDeployment(fixture.publicDeployment, {
      GHOSTCLAW_DEMO_MERCHANT_DEPLOYMENT_JSON: JSON.stringify({ ...fixture.deployment, [key]: value }),
      GHOSTCLAW_DEMO_MERCHANT_SECRET: fixture.secret,
    }), { message: "The hosted demo merchant configuration is unavailable." }, key);
  }
});

test("missing or invalid hosted deployment secrets return a generic 503 without private detail", async () => {
  const fixture = deploymentFixture();
  const valid = {
    GHOSTCLAW_DEMO_MERCHANT_DEPLOYMENT_JSON: JSON.stringify(fixture.deployment),
    GHOSTCLAW_DEMO_MERCHANT_SECRET: fixture.secret,
  };
  const cases = [
    {},
    { ...valid, GHOSTCLAW_DEMO_MERCHANT_DEPLOYMENT_JSON: "private-invalid-json" },
    { ...valid, GHOSTCLAW_DEMO_MERCHANT_DEPLOYMENT_JSON: "x".repeat(3 * 1024 * 1024 + 1) },
    { ...valid, GHOSTCLAW_DEMO_MERCHANT_DEPLOYMENT_JSON: JSON.stringify({ ...fixture.deployment, owner: "6789" }) },
    { ...valid, GHOSTCLAW_DEMO_MERCHANT_DEPLOYMENT_JSON: JSON.stringify({ ...fixture.deployment, sealedState: null }) },
    { ...valid, GHOSTCLAW_DEMO_MERCHANT_SECRET: undefined },
    { ...valid, GHOSTCLAW_DEMO_MERCHANT_SECRET: newHostedSecret() },
  ];
  for (const environment of cases) {
    const response = responseCapture();
    await handleVercelAddressReport({}, response, () => loadDemoMerchantDeployment(fixture.publicDeployment, environment));
    assert.equal(response.status, 503);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.deepEqual(response.json(), { error: "address_report_unavailable" });
  }
});

test("hosted JSON state is authenticated and purpose-bound", () => {
  const secret = newHostedSecret();
  const envelope = sealJson({ private: "value" }, secret, { purpose: "test", aad: "test-context" });
  assert.deepEqual(
    openSealedJson(envelope, secret, { purpose: "test", aad: "test-context" }),
    { private: "value" },
  );
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const finalTagIndex = alphabet.indexOf(envelope.tag.at(-1));
  const changed = {
    ...envelope,
    // A 16-byte tag leaves two unused bits in its final base64url character.
    // Reject an alternate string that decodes to the same authenticated bytes.
    tag: `${envelope.tag.slice(0, -1)}${alphabet[finalTagIndex + 1]}`,
  };
  assert.deepEqual(Buffer.from(changed.tag, "base64url"), Buffer.from(envelope.tag, "base64url"));
  assert.throws(
    () => openSealedJson(changed, secret, { purpose: "test", aad: "test-context" }),
    /failed authentication/,
  );
});

test("the hosted merchant state stays encrypted and uses a distributed lock", async () => {
  const secret = newHostedSecret();
  const pair = generateKeyPairSync("x25519");
  const transactionPrivateKey = generatePrivateKey();
  const merchant = privateKeyToAccount(transactionPrivateKey).address;
  const state = {
    version: 3,
    keySet: "ab".repeat(16),
    spendKey: "1234",
    owner: "5678",
    account: merchant,
    transactionSignerMode: "local",
    transactionPrivateKey,
    noteEncryptionPrivateKey: pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    noteEncryptionPublicKey: pair.publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    notes: [],
    history: [],
    receivedSettlements: [],
  };
  const deployment = {
    version: 1,
    network: "base-sepolia",
    merchant,
    owner: state.owner,
    noteEncryptionPublicKey: state.noteEncryptionPublicKey,
    sealedState: sealJson(state, secret, {
      purpose: "demo-merchant-state",
      aad: `ghostclaw-demo-merchant-state-v1:${merchant.toLowerCase()}`,
    }),
  };
  const redis = new MemoryRedis();
  const store = new DemoMerchantStateStore({ redis, secret, deployment });
  assert.equal((await store.loadState()).transactionPrivateKey, transactionPrivateKey);
  const saved = await store.loadState();
  saved.notes.push({ commitment: "9" });
  await store.saveState(saved);
  assert.equal((await store.loadState()).notes[0].commitment, "9");
  assert.equal((await redis.get(store.stateKey)).includes(transactionPrivateKey.slice(2)), false);

  let release;
  let entered;
  const enteredPromise = new Promise((resolve) => { entered = resolve; });
  const held = store.withWalletLock(async () => {
    entered();
    await new Promise((resolve) => { release = resolve; });
  });
  await enteredPromise;
  await assert.rejects(() => store.withWalletLock(async () => {}), /wallet is busy/);
  release();
  await held;
});

test("Upstash commands use one bounded REST request", async () => {
  const commands = [];
  const store = new UpstashStore({
    url: "https://redis.example",
    token: "token-token-token-token",
    fetchImpl: async (_url, init) => {
      commands.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ result: "OK" }), { status: 200 });
    },
  });
  await store.set("safe:key", "value", { nx: true, px: 1_000 });
  assert.deepEqual(commands, [["SET", "safe:key", "value", "NX", "PX", "1000"]]);
});

test("the paid address report is durable and can be delivered without another payment", async () => {
  const redis = new MemoryRedis();
  const store = new DemoReportStore({ redis, secret: newHostedSecret() });
  let builds = 0;
  const handler = createAddressReportHandler({
    merchant: MERCHANT,
    store,
    limiter: { preflight: async () => true },
    gate: async (request) => request.headers["payment-signature"]
      ? { paid: true, settlement: { transactionHash: TRANSACTION } }
      : {
          paid: false,
          status: 402,
          headers: { "payment-required": "encoded" },
          body: { error: "Payment required" },
        },
    buildReport: async (address) => {
      builds += 1;
      return { version: 1, address, result: "public-data" };
    },
  });
  const unpaid = responseCapture();
  await handler({
    method: "GET",
    url: `/demo/address-report?address=${ADDRESS}`,
    headers: { host: "merchant.example", "x-forwarded-proto": "https" },
  }, unpaid);
  assert.equal(unpaid.status, 402);
  assert.equal(unpaid.headers["payment-required"], "encoded");

  const paid = responseCapture();
  await handler({
    method: "GET",
    url: `/demo/address-report?address=${ADDRESS}`,
    headers: {
      host: "merchant.example",
      "x-forwarded-proto": "https",
      "payment-signature": "settled",
    },
  }, paid);
  assert.equal(paid.status, 200);
  assert.equal(paid.json().status, "ready");
  assert.equal(builds, 1);

  const delivered = responseCapture();
  await handler({
    method: "GET",
    url: new URL(paid.json().deliveryUrl).pathname + new URL(paid.json().deliveryUrl).search,
    headers: { host: "merchant.example", "x-forwarded-proto": "https" },
  }, delivered);
  assert.equal(delivered.status, 200);
  assert.equal(delivered.json().report.result, "public-data");

  const retried = responseCapture();
  await handler({
    method: "GET",
    url: `/demo/address-report?address=${ADDRESS}`,
    headers: {
      host: "merchant.example",
      "x-forwarded-proto": "https",
      "payment-signature": "settled",
    },
  }, retried);
  assert.equal(retried.status, 200);
  assert.equal(builds, 1);
});

test("a settled report failure requests a retry without logging private details", async () => {
  const messages = [];
  const handler = createAddressReportHandler({
    merchant: MERCHANT,
    store: new DemoReportStore({ redis: new MemoryRedis(), secret: newHostedSecret() }),
    gate: async () => ({ paid: true, settlement: { transactionHash: TRANSACTION } }),
    buildReport: async () => { throw new Error("private failure detail"); },
    logError: (message) => messages.push(message),
  });
  const response = responseCapture();
  await handler({
    method: "GET",
    url: `/demo/address-report?address=${ADDRESS}`,
    headers: { host: "merchant.example", "x-forwarded-proto": "https" },
  }, response);

  assert.equal(response.status, 503);
  assert.equal(response.headers["retry-after"], "2");
  assert.equal(response.json().error, "report_temporarily_unavailable");
  assert.deepEqual(JSON.parse(messages[0]), {
    event: "demo_address_report_failed",
    stage: "report-build",
  });
  assert.equal(messages[0].includes("private failure detail"), false);
});

test("the report states the privacy boundary and tolerates a public-index outage", async () => {
  const report = await buildAddressReport(ADDRESS, {
    publicClient: {
      getBalance: async () => 1_000_000_000_000_000_000n,
      getTransactionCount: async () => 3,
      getBytecode: async () => undefined,
      getBlockNumber: async () => 100n,
      readContract: async ({ functionName }) => functionName === "balanceOf" ? 2_000_000n : 99n,
    },
    fetchImpl: async () => new Response("unavailable", { status: 503 }),
  });
  assert.equal(report.overview.publicTestGusdBalance, "2");
  assert.equal(report.overview.ghostclawRegistered, true);
  assert.equal(report.indexStatus, "temporarily-unavailable");
  assert.match(report.privacyBoundary, /cannot read GhostClaw note balances/);
});
