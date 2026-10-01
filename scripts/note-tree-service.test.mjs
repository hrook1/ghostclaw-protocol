import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, encodeEventTopics, parseAbiItem } from "viem";
import { createPublicNoteTreeHandler } from "./lib/note-tree-service.mjs";
import { CONTRACTS } from "./lib/protocol.mjs";

const EVENT = parseAbiItem(
  "event NotesInserted(uint256 indexed pairIndex,uint256 left,uint256 right,uint256 root)",
);

function responseFor(id, result, status = 200) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function run(handler, method = "GET") {
  return new Promise((resolve) => {
    handler({
      method,
      headers: { "x-forwarded-for": "203.0.113.7" },
      socket: {},
    }, {
      writeHead(status, headers) {
        this.status = status;
        this.headers = headers;
      },
      end(body) {
        resolve({ status: this.status, headers: this.headers, body: JSON.parse(String(body)) });
      },
    });
  });
}

test("the hosted tree feed returns only the fixed public pool events", async () => {
  const requests = [];
  const block = CONTRACTS.deploymentBlock + 2n;
  const topics = encodeEventTopics({ abi: [EVENT], eventName: "NotesInserted", args: { pairIndex: 0n } });
  const data = encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
    [11n, 22n, 33n],
  );
  const limiterInputs = [];
  const handler = createPublicNoteTreeHandler({
    rpcUrl: "https://base.example/v2/private-key",
    limiter: {
      preflight(input) {
        limiterInputs.push(input);
        return true;
      },
    },
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      requests.push(request);
      if (request.method === "eth_blockNumber") {
        return responseFor(request.id, `0x${block.toString(16)}`);
      }
      return responseFor(request.id, [{
        address: CONTRACTS.pool,
        blockNumber: `0x${(CONTRACTS.deploymentBlock + 1n).toString(16)}`,
        logIndex: "0x0",
        removed: false,
        topics,
        data,
      }]);
    },
  });
  const result = await run(handler);
  assert.equal(result.status, 200);
  assert.equal(result.headers["cache-control"], "public, s-maxage=300, stale-while-revalidate=3600");
  assert.deepEqual(limiterInputs, [{ route: "/note-tree", ip: "203.0.113.7" }]);
  assert.deepEqual(requests.map((request) => request.method), ["eth_blockNumber", "eth_getLogs"]);
  assert.equal(requests[1].params[0].address, CONTRACTS.pool);
  assert.deepEqual(result.body.logs, [{
    blockNumber: (CONTRACTS.deploymentBlock + 1n).toString(),
    logIndex: "0",
    pairIndex: "0",
    left: "11",
    right: "22",
    root: "33",
  }]);
});

test("the hosted tree feed rejects other methods and rate-limited callers", async () => {
  const handler = createPublicNoteTreeHandler({
    rpcUrl: "https://base.example/v2/private-key",
    limiter: { preflight: () => false },
    fetchImpl: async () => {
      throw new Error("The upstream must not run.");
    },
  });
  assert.deepEqual(await run(handler, "POST"), {
    status: 404,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "content-length": 22,
      "x-content-type-options": "nosniff",
    },
    body: { error: "not_found" },
  });
  const limited = await run(handler);
  assert.equal(limited.status, 429);
  assert.deepEqual(limited.body, { error: "rate_limit" });
});

test("the hosted tree feed keeps each upstream log request within 2,000 blocks", async () => {
  const block = CONTRACTS.deploymentBlock + 2_000n;
  const logFilters = [];
  const handler = createPublicNoteTreeHandler({
    rpcUrl: "https://base.example/v2/private-key",
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      if (request.method === "eth_blockNumber") {
        return responseFor(request.id, `0x${block.toString(16)}`);
      }
      logFilters.push(request.params[0]);
      return responseFor(request.id, []);
    },
  });
  const result = await run(handler);
  assert.equal(result.status, 200);
  assert.deepEqual(logFilters.map(({ fromBlock, toBlock }) => ({ fromBlock, toBlock })), [
    {
      fromBlock: `0x${CONTRACTS.deploymentBlock.toString(16)}`,
      toBlock: `0x${(CONTRACTS.deploymentBlock + 1_999n).toString(16)}`,
    },
    {
      fromBlock: `0x${(CONTRACTS.deploymentBlock + 2_000n).toString(16)}`,
      toBlock: `0x${(CONTRACTS.deploymentBlock + 2_000n).toString(16)}`,
    },
  ]);
});

test("the hosted tree feed waits and retries a rate-limited public event read", async () => {
  const block = CONTRACTS.deploymentBlock;
  const delays = [];
  let logAttempts = 0;
  const handler = createPublicNoteTreeHandler({
    rpcUrl: "https://base.example/v2/private-key",
    wait: async (milliseconds) => delays.push(milliseconds),
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      if (request.method === "eth_blockNumber") {
        return responseFor(request.id, `0x${block.toString(16)}`);
      }
      logAttempts += 1;
      if (logAttempts === 1) {
        return new Response(JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          error: { code: 429, message: "private provider detail" },
        }), { status: 429, headers: { "content-type": "application/json" } });
      }
      return responseFor(request.id, []);
    },
  });
  const result = await run(handler);
  assert.equal(result.status, 200);
  assert.equal(logAttempts, 2);
  assert.deepEqual(delays, [250]);
});

test("the hosted tree feed stops after bounded provider-limit retries", async () => {
  const block = CONTRACTS.deploymentBlock;
  const delays = [];
  let logAttempts = 0;
  const handler = createPublicNoteTreeHandler({
    rpcUrl: "https://base.example/v2/private-key",
    wait: async (milliseconds) => delays.push(milliseconds),
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      if (request.method === "eth_blockNumber") {
        return responseFor(request.id, `0x${block.toString(16)}`);
      }
      logAttempts += 1;
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32005, message: "private provider detail" },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const result = await run(handler);
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, { error: "note_tree_unavailable" });
  assert.equal(logAttempts, 5);
  assert.deepEqual(delays, [250, 500, 1_000, 2_000]);
  assert.equal(JSON.stringify(result.body).includes("private provider detail"), false);
});

test("the hosted tree feed hides upstream failures", async () => {
  const handler = createPublicNoteTreeHandler({
    rpcUrl: "https://base.example/v2/private-key",
    fetchImpl: async () => new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32000, message: "private provider detail" },
    })),
  });
  const result = await run(handler);
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, { error: "note_tree_unavailable" });
  assert.equal(JSON.stringify(result.body).includes("private provider detail"), false);
});

test("the hosted tree feed rejects a changed event address", async () => {
  const block = CONTRACTS.deploymentBlock;
  const topics = encodeEventTopics({ abi: [EVENT], eventName: "NotesInserted", args: { pairIndex: 0n } });
  const data = encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
    [11n, 22n, 33n],
  );
  const handler = createPublicNoteTreeHandler({
    rpcUrl: "https://base.example/v2/private-key",
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      if (request.method === "eth_blockNumber") {
        return responseFor(request.id, `0x${block.toString(16)}`);
      }
      return responseFor(request.id, [{
        address: "0x1111111111111111111111111111111111111111",
        blockNumber: `0x${block.toString(16)}`,
        logIndex: "0x0",
        removed: false,
        topics,
        data,
      }]);
    },
  });
  const result = await run(handler);
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, { error: "note_tree_unavailable" });
});
