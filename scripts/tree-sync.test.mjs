import assert from "node:assert/strict";
import test from "node:test";
import {
  collectNoteTree,
  loadPublicNoteSnapshot,
  spendInputForNote,
} from "./lib/tree-sync.mjs";

const POOL = "0x1111111111111111111111111111111111111111";

function dependencies(logs, root = 777n) {
  return {
    pool: POOL,
    fromBlock: 10n,
    toBlock: 20n,
    client: {
      getLogs: async () => logs,
    },
    readPool: async (name) => name === "nextLeafIndex" ? BigInt(logs.length * 2) : root,
    treeWitness: async (_leaves, leafIndex) => ({
      root: root.toString(),
      pathSiblings: Array(20).fill("0"),
      pathBits: Array(20).fill(0).map((value, index) => index === 0 ? leafIndex % 2 : value),
    }),
    loadSnapshot: false,
    logQueryDelay: 0,
  };
}

test("the wallet rebuilds the ordered public note tree before it creates a witness", async () => {
  const logs = [
    { blockNumber: 11n, logIndex: 1, args: { pairIndex: 1n, left: 33n, right: 44n } },
    { blockNumber: 11n, logIndex: 0, args: { pairIndex: 0n, left: 11n, right: 22n } },
  ];
  const options = dependencies(logs);
  const tree = await collectNoteTree(options);
  assert.deepEqual(tree.leaves, ["11", "22", "33", "44"]);
  assert.equal(tree.currentRoot, "777");

  const input = await spendInputForNote({
    amount: "25",
    owner: "91",
    blinding: "92",
    commitment: "33",
    outputPosition: 0,
  }, { tree, treeWitness: options.treeWitness });
  assert.equal(input.spendRoot, "777");
  assert.equal(input.note.commitment, "33");
  assert.equal(input.pathBits[0], 0);
});

test("the wallet rejects missing pair events and a mismatched rebuilt root", async () => {
  const missing = dependencies([
    { blockNumber: 11n, logIndex: 0, args: { pairIndex: 1n, left: 11n, right: 22n } },
  ]);
  await assert.rejects(collectNoteTree(missing), /missing or repeated pair index/);

  const changed = dependencies([
    { blockNumber: 11n, logIndex: 0, args: { pairIndex: 0n, left: 11n, right: 22n } },
  ], 888n);
  changed.treeWitness = async () => ({ root: "777" });
  await assert.rejects(collectNoteTree(changed), /does not match the Base root/);
});

test("the wallet keeps every Base log query within 2,000 inclusive blocks", async () => {
  const ranges = [];
  const options = dependencies([]);
  options.toBlock = 5_010n;
  options.client.getLogs = async ({ fromBlock, toBlock }) => {
    ranges.push([fromBlock, toBlock]);
    return [];
  };
  const tree = await collectNoteTree(options);
  assert.equal(tree.nextLeafIndex, "0");
  assert.deepEqual(ranges, [
    [10n, 2_009n],
    [2_010n, 4_009n],
    [4_010n, 5_010n],
  ]);
});

test("the wallet uses the public snapshot and reads only later Base events", async () => {
  const ranges = [];
  const options = dependencies([], 777n);
  options.client.getLogs = async ({ fromBlock, toBlock }) => {
    ranges.push([fromBlock, toBlock]);
    return [{
      blockNumber: 20n,
      logIndex: 0,
      args: { pairIndex: 1n, left: 33n, right: 44n },
    }];
  };
  options.readPool = async (name, _args, readOptions) => {
    assert.equal(readOptions.blockNumber, 20n);
    return name === "nextLeafIndex" ? 4n : 777n;
  };
  options.loadSnapshot = async () => ({
    version: 1,
    network: "base-sepolia",
    pool: POOL,
    fromBlock: "10",
    toBlock: "19",
    logs: [{
      blockNumber: "11",
      logIndex: "0",
      pairIndex: "0",
      left: "11",
      right: "22",
      root: "777",
    }],
  });
  const tree = await collectNoteTree(options);
  assert.deepEqual(tree.leaves, ["11", "22", "33", "44"]);
  assert.deepEqual(ranges, [[20n, 20n]]);
});

test("the wallet discards a snapshot that does not match the Base root", async () => {
  const ranges = [];
  const options = dependencies([], 777n);
  options.client.getLogs = async ({ fromBlock, toBlock }) => {
    ranges.push([fromBlock, toBlock]);
    if (fromBlock === 10n) {
      return [{
        blockNumber: 11n,
        logIndex: 0,
        args: { pairIndex: 0n, left: 11n, right: 22n },
      }];
    }
    return [];
  };
  options.readPool = async (name) => name === "nextLeafIndex" ? 2n : 777n;
  options.treeWitness = async (leaves) => ({ root: leaves[0] === "11" ? "777" : "999" });
  options.loadSnapshot = async () => ({
    version: 1,
    network: "base-sepolia",
    pool: POOL,
    fromBlock: "10",
    toBlock: "19",
    logs: [{
      blockNumber: "11",
      logIndex: "0",
      pairIndex: "0",
      left: "99",
      right: "88",
      root: "999",
    }],
  });
  const tree = await collectNoteTree(options);
  assert.deepEqual(tree.leaves, ["11", "22"]);
  assert.deepEqual(ranges, [[20n, 20n], [10n, 20n]]);
});

test("the wallet reads Base directly when the hosted snapshot is unavailable", async () => {
  const ranges = [];
  const options = dependencies([]);
  options.loadSnapshot = async () => {
    throw new Error("service unavailable");
  };
  options.client.getLogs = async ({ fromBlock, toBlock }) => {
    ranges.push([fromBlock, toBlock]);
    return [];
  };
  await collectNoteTree(options);
  assert.deepEqual(ranges, [[10n, 20n]]);
});

test("the wallet propagates a failed Base delta read instead of starting a costly full scan", async () => {
  const options = dependencies([]);
  options.loadSnapshot = async () => ({
    version: 1,
    network: "base-sepolia",
    pool: POOL,
    fromBlock: "10",
    toBlock: "19",
    logs: [],
  });
  let calls = 0;
  options.client.getLogs = async () => {
    calls += 1;
    throw new Error("Base delta unavailable");
  };
  await assert.rejects(collectNoteTree(options), /Base delta unavailable/);
  assert.equal(calls, 1);
});

test("the wallet waits and retries a rate-limited Base log query", async () => {
  const waits = [];
  let calls = 0;
  const options = dependencies([]);
  options.client.getLogs = async () => {
    calls += 1;
    if (calls < 3) {
      const error = new Error("over rate limit");
      error.status = 429;
      throw error;
    }
    return [];
  };
  options.rateLimitDelays = [10, 20];
  options.sleep = async (delay) => waits.push(delay);
  await collectNoteTree(options);
  assert.equal(calls, 3);
  assert.deepEqual(waits, [10, 20]);
});

test("the wallet does not hide a non-rate-limit Base error", async () => {
  const options = dependencies([]);
  let calls = 0;
  options.client.getLogs = async () => {
    calls += 1;
    throw new Error("invalid filter");
  };
  await assert.rejects(collectNoteTree(options), /invalid filter/);
  assert.equal(calls, 1);
});

test("the wallet stops after the bounded Base rate-limit retries", async () => {
  const waits = [];
  const options = dependencies([]);
  options.client.getLogs = async () => {
    throw new Error("HTTP 429: too many requests");
  };
  options.rateLimitDelays = [10, 20];
  options.sleep = async (delay) => waits.push(delay);
  await assert.rejects(collectNoteTree(options), /429/);
  assert.deepEqual(waits, [10, 20]);
});

test("the public snapshot loader requires a credential-free secure URL", async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return new Response("{}");
  };
  await assert.rejects(
    loadPublicNoteSnapshot({ url: "http://snapshot.example", fetchImpl }),
    /snapshot URL is invalid/,
  );
  await assert.rejects(
    loadPublicNoteSnapshot({ url: "https://user:secret@snapshot.example", fetchImpl }),
    /snapshot URL is invalid/,
  );
  assert.equal(called, false);
});

test("the public snapshot loader rejects an oversized response before parsing", async () => {
  await assert.rejects(loadPublicNoteSnapshot({
    url: "https://snapshot.example/note-tree",
    fetchImpl: async () => new Response("{}", {
      headers: { "content-length": String(16 * 1024 * 1024 + 1) },
    }),
  }), /snapshot is unavailable/);
});
