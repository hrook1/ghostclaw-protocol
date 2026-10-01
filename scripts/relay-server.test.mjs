import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { encodeFunctionData, zeroAddress } from "viem";
import {
  createGhostClawRelay,
  createGhostClawRelayHandler,
} from "./lib/relay-server.mjs";
import { CHAIN_ID, CONTRACTS, poolAbi } from "./lib/protocol.mjs";

const POLICY_ID = "ghostclaw-test-policy";
const UNDELEGATION_POLICY_ID = "ghostclaw-test-undelegation-policy";
const API_KEY = "alchemy-private-test-key";
const SPONSOR_SECRET = "test-sponsor-callback-secret-32-bytes";
const SENDER = "0x1111111111111111111111111111111111111111";
const PROOF = `0x${"11".repeat(768)}`;

function preparePayload(call, id = 1) {
  return {
    jsonrpc: "2.0",
    id,
    method: "wallet_prepareCalls",
    params: [{
      from: SENDER,
      chainId: `0x${CHAIN_ID.toString(16)}`,
      calls: [call],
    }],
  };
}

function registerCall(target = CONTRACTS.pool) {
  return {
    to: target,
    value: "0x0",
    data: encodeFunctionData({ abi: poolAbi, functionName: "registerSelf", args: [PROOF, 1n] }),
  };
}

function dispatch(server, method, url, payload, headers = {}) {
  const body = payload === undefined ? [] : [Buffer.from(JSON.stringify(payload))];
  const request = Readable.from(body);
  request.method = method;
  request.url = url;
  request.headers = payload === undefined
    ? headers
    : { "content-type": "application/json", ...headers };
  return new Promise((resolve) => {
    const response = {
      writeHead(status, headers) {
        this.status = status;
        this.headers = headers;
      },
      end(data) {
        resolve({
          status: this.status,
          headers: this.headers,
          body: JSON.parse(String(data)),
        });
      },
    };
    server.emit("request", request, response);
  });
}

test("the public relay keeps Alchemy credentials on the server", async () => {
  const upstreamRequests = [];
  const rateKeys = [];
  const server = createGhostClawRelay({
    policyId: POLICY_ID,
    apiKey: API_KEY,
    sponsorToken: SPONSOR_SECRET,
    fetchImpl: async (url, options) => {
      upstreamRequests.push({ url, options, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: upstreamRequests.at(-1).body.id,
        result: {
          ready: true,
          accidentalSecret: API_KEY,
          accidentalWebhookSecret: SPONSOR_SECRET,
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
    limiter: {
      preflight(input) {
        rateKeys.push({ stage: "preflight", ...input });
        return true;
      },
      allow(input) {
        rateKeys.push({ stage: "authorized", ...input });
        return true;
      },
    },
  });

  const health = await dispatch(server, "GET", "/health");
  assert.deepEqual(health.body, { status: "ready" });

  const response = await dispatch(server, "POST", "/rpc", preparePayload(registerCall()));
  const result = response.body;
  assert.equal(response.status, 200);
  assert.equal(upstreamRequests.length, 1);
  assert.equal(upstreamRequests[0].url, "https://api.g.alchemy.com/v2");
  assert.equal(upstreamRequests[0].options.headers.authorization, `Bearer ${API_KEY}`);
  assert.equal(
    upstreamRequests[0].body.params[0].capabilities.paymasterService.policyId,
    POLICY_ID,
  );
  assert.equal(
    upstreamRequests[0].body.params[0].capabilities.paymasterService.webhookData,
    SPONSOR_SECRET,
  );
  assert.equal(JSON.stringify(result).includes(API_KEY), false);
  assert.equal(JSON.stringify(result).includes(SPONSOR_SECRET), false);
  assert.equal(rateKeys.length, 2);
  assert.equal(rateKeys[0].stage, "preflight");
  assert.equal(rateKeys[1].stage, "authorized");
  assert.equal(rateKeys[1].sender, SENDER);

  const rejected = await dispatch(server, "POST", "/rpc", preparePayload(registerCall(
    "0x2222222222222222222222222222222222222222",
  ), 2));
  const rejectedBody = rejected.body;
  assert.equal(rejectedBody.error.code, -32602);
  assert.equal(upstreamRequests.length, 1);
});

test("the relay uses a separate policy for emergency undelegation", async () => {
  let upstreamBody;
  const server = createGhostClawRelay({
    policyId: POLICY_ID,
    undelegationPolicyId: UNDELEGATION_POLICY_ID,
    apiKey: API_KEY,
    sponsorToken: SPONSOR_SECRET,
    fetchImpl: async (_url, options) => {
      upstreamBody = JSON.parse(options.body);
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: upstreamBody.id,
        result: { type: "authorization" },
      }));
    },
  });
  const response = await dispatch(server, "POST", "/rpc", {
    jsonrpc: "2.0",
    id: 7,
    method: "wallet_prepareCalls",
    params: [{
      from: SENDER,
      chainId: `0x${CHAIN_ID.toString(16)}`,
      calls: [],
      capabilities: { eip7702Auth: { delegation: zeroAddress } },
    }],
  });
  assert.equal(response.status, 200);
  assert.deepEqual(upstreamBody.params[0].capabilities, {
    paymasterService: { policyId: UNDELEGATION_POLICY_ID },
    eip7702Auth: { delegation: zeroAddress },
  });
});

test("the sponsorship webhook uses the same contract policy", async () => {
  const server = createGhostClawRelay({ policyId: POLICY_ID, apiKey: API_KEY });
  const call = registerCall();
  const response = await dispatch(server, "POST", "/alchemy/sponsor", {
    policyId: POLICY_ID,
    chainId: `0x${CHAIN_ID.toString(16)}`,
    userOperation: {
      sender: SENDER,
      callData: (await import("@alchemy/smart-accounts")).encodeCallsMAv2([call]),
    },
  });
  assert.deepEqual(response.body, { approved: true });
});

test("the sponsorship webhook requires its callback secret when configured", async () => {
  const server = createGhostClawRelay({
    policyId: POLICY_ID,
    apiKey: API_KEY,
    sponsorToken: SPONSOR_SECRET,
  });
  const payload = {
    policyId: POLICY_ID,
    chainId: `0x${CHAIN_ID.toString(16)}`,
    userOperation: {
      sender: SENDER,
      callData: (await import("@alchemy/smart-accounts")).encodeCallsMAv2([registerCall()]),
    },
  };
  const denied = await dispatch(server, "POST", "/alchemy/sponsor", payload);
  assert.equal(denied.status, 200);
  assert.deepEqual(denied.body, { approved: false });

  const accepted = await dispatch(server, "POST", "/alchemy/sponsor", {
    ...payload,
    webhookData: SPONSOR_SECRET,
  });
  assert.deepEqual(accepted.body, { approved: true });
});

test("proof-bearing relay calls consume their larger limit weight", async () => {
  let authorizedLimit;
  const server = createGhostClawRelay({
    policyId: POLICY_ID,
    apiKey: API_KEY,
    fetchImpl: async (_url, options) => new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: JSON.parse(options.body).id,
      result: { ready: true },
    })),
    limiter: {
      preflight: () => true,
      allow(input) {
        authorizedLimit = input;
        return true;
      },
    },
  });
  const depositCall = {
    to: CONTRACTS.pool,
    value: "0x0",
    data: encodeFunctionData({
      abi: poolAbi,
      functionName: "deposit",
      args: [`0x${"00".repeat(768)}`, 1n, 1n],
    }),
  };
  const response = await dispatch(server, "POST", "/rpc", preparePayload(depositCall));
  assert.equal(response.status, 200);
  assert.equal(authorizedLimit.cost, 10);
});

test("the sponsorship webhook fails closed when independent simulation rejects a call", async () => {
  const server = createGhostClawRelay({
    policyId: POLICY_ID,
    apiKey: API_KEY,
    simulationRpcUrl: "https://base.example.invalid",
    simulationFetchImpl: async () => new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      error: { code: 3, message: "execution reverted" },
    })),
  });
  const call = registerCall();
  const response = await dispatch(server, "POST", "/alchemy/sponsor", {
    policyId: POLICY_ID,
    chainId: `0x${CHAIN_ID.toString(16)}`,
    userOperation: {
      sender: SENDER,
      callData: (await import("@alchemy/smart-accounts")).encodeCallsMAv2([call]),
    },
  });
  assert.deepEqual(response.body, { approved: false });
});

test("the serverless handler accepts the host parsed JSON body", async () => {
  const handler = createGhostClawRelayHandler({
    policyId: POLICY_ID,
    apiKey: API_KEY,
    fetchImpl: async (_url, options) => new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: JSON.parse(options.body).id,
      result: { ready: true },
    })),
  });
  const request = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: preparePayload(registerCall()),
  };
  const response = await new Promise((resolve) => {
    const outgoing = {
      writeHead(status, headers) {
        this.status = status;
        this.headers = headers;
      },
      end(data) {
        resolve({ status: this.status, body: JSON.parse(String(data)) });
      },
    };
    handler(request, outgoing, "/rpc");
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.result, { ready: true });
});
