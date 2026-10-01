import { parseAbiItem } from "viem";
import {
  BN254_SCALAR_FIELD,
  CONTRACTS,
  NETWORK,
  PUBLIC_NOTE_TREE_URL,
} from "./protocol.mjs";
import { publicClient, readPool } from "./alchemy-adapter.mjs";
import { treeWitness } from "./prover.mjs";

const NOTES_INSERTED = parseAbiItem(
  "event NotesInserted(uint256 indexed pairIndex,uint256 left,uint256 right,uint256 root)",
);
// Base's public RPC accepts at most 2,000 inclusive blocks in one log query.
const LOG_BLOCK_RANGE = 1_999n;
const LOG_QUERY_DELAY_MS = 250;
const RATE_LIMIT_DELAYS_MS = Object.freeze([1_000, 2_000, 4_000, 8_000, 16_000]);
const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;
const MAX_TREE_PAIRS = 1 << 19;

function sleep(delay) {
  return new Promise((resolve) => setTimeout(resolve, delay));
}

function errorDescription(error) {
  const values = [];
  let current = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    values.push(current.name, current.code, current.status, current.message, current.details, current.shortMessage);
    current = current.cause;
  }
  return values.filter((value) => value !== undefined && value !== null).join(" ");
}

function rateLimited(error) {
  return /(?:rate.?limit|too many requests|\b429\b)/i.test(errorDescription(error));
}

async function getLogsWithRecovery(client, parameters, options) {
  const delays = options.rateLimitDelays ?? RATE_LIMIT_DELAYS_MS;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await client.getLogs(parameters);
    } catch (error) {
      if (!rateLimited(error) || attempt >= delays.length) throw error;
      options.onRateLimit?.({ attempt: attempt + 1, delay: delays[attempt] });
      await options.sleep(delays[attempt]);
    }
  }
}

function parseSnapshotInteger(value, label) {
  if (!/^(0|[1-9][0-9]*)$/.test(String(value ?? ""))) {
    throw new Error(`${label} is invalid.`);
  }
  return BigInt(value);
}

function parseSnapshotField(value, label) {
  const parsed = parseSnapshotInteger(value, label);
  if (parsed >= BN254_SCALAR_FIELD) throw new Error(`${label} is outside the proof field.`);
  return parsed;
}

function snapshotLogs(value, pool, fromBlock, toBlock) {
  if (
    value?.version !== 1
    || value.network !== NETWORK
    || String(value.pool).toLowerCase() !== pool.toLowerCase()
    || parseSnapshotInteger(value.fromBlock, "The note snapshot start block") !== fromBlock
    || parseSnapshotInteger(value.toBlock, "The note snapshot end block") > toBlock
    || !Array.isArray(value.logs)
    || value.logs.length > MAX_TREE_PAIRS
  ) {
    throw new Error("The hosted public note snapshot is invalid.");
  }
  const snapshotEnd = BigInt(value.toBlock);
  return {
    toBlock: snapshotEnd,
    logs: value.logs.map((log) => {
      const blockNumber = parseSnapshotInteger(log.blockNumber, "The note block number");
      const logIndex = parseSnapshotInteger(log.logIndex, "The note log index");
      if (
        blockNumber < fromBlock
        || blockNumber > snapshotEnd
        || logIndex > BigInt(Number.MAX_SAFE_INTEGER)
      ) {
        throw new Error("The hosted public note position is invalid.");
      }
      return {
        blockNumber,
        logIndex: Number(logIndex),
        args: {
          pairIndex: parseSnapshotInteger(log.pairIndex, "The note pair index"),
          left: parseSnapshotField(log.left, "The left note commitment"),
          right: parseSnapshotField(log.right, "The right note commitment"),
          root: parseSnapshotField(log.root, "The note tree root"),
        },
      };
    }),
  };
}

export async function loadPublicNoteSnapshot(options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const configuredUrl = options.url
    ?? process.env.GHOSTCLAW_NOTE_TREE_URL?.trim()
    ?? PUBLIC_NOTE_TREE_URL;
  const url = new URL(configuredUrl);
  const loopback = url.hostname === "localhost"
    || url.hostname === "127.0.0.1"
    || url.hostname === "[::1]";
  if (
    (url.protocol !== "https:" && !(loopback && url.protocol === "http:"))
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new Error("The public note snapshot URL is invalid.");
  }
  const response = await fetchImpl(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(options.timeout ?? 30_000),
  });
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (!response.ok || declaredLength > MAX_SNAPSHOT_BYTES) {
    throw new Error("The hosted public note snapshot is unavailable.");
  }
  const body = await response.text();
  if (Buffer.byteLength(body) > MAX_SNAPSHOT_BYTES) {
    throw new Error("The hosted public note snapshot is too large.");
  }
  return JSON.parse(body);
}

function orderedLogs(logs) {
  return [...logs].sort((left, right) => {
    if (left.blockNumber !== right.blockNumber) {
      return left.blockNumber < right.blockNumber ? -1 : 1;
    }
    return Number(left.logIndex) - Number(right.logIndex);
  });
}

export async function collectNoteTree(options = {}) {
  const client = options.client ?? publicClient;
  const readPoolValue = options.readPool ?? readPool;
  const makeWitness = options.treeWitness ?? treeWitness;
  const wait = options.sleep ?? sleep;
  const pool = options.pool ?? CONTRACTS.pool;
  const fromBlock = BigInt(options.fromBlock ?? CONTRACTS.deploymentBlock);
  if (BigInt(fromBlock) <= 0n) {
    throw new Error("The v2 pool deployment block is not configured.");
  }
  const toBlock = BigInt(options.toBlock ?? await client.getBlockNumber());

  async function queryLogs(startBlock, initialLogs = []) {
    const logs = [...initialLogs];
    for (let start = startBlock; start <= toBlock; start += LOG_BLOCK_RANGE + 1n) {
      const end = start + LOG_BLOCK_RANGE > toBlock ? toBlock : start + LOG_BLOCK_RANGE;
      logs.push(...await getLogsWithRecovery(client, {
        address: pool,
        event: NOTES_INSERTED,
        fromBlock: start,
        toBlock: end,
        strict: true,
      }, {
        sleep: wait,
        rateLimitDelays: options.rateLimitDelays,
        onRateLimit: options.onRateLimit,
      }));
      if (end < toBlock && (options.logQueryDelay ?? LOG_QUERY_DELAY_MS) > 0) {
        await wait(options.logQueryDelay ?? LOG_QUERY_DELAY_MS);
      }
    }
    return logs;
  }

  let logs;
  let usedSnapshot = false;
  const loadSnapshot = options.loadSnapshot === false
    ? null
    : (options.loadSnapshot ?? loadPublicNoteSnapshot);
  let snapshot = null;
  if (loadSnapshot) {
    try {
      snapshot = snapshotLogs(await loadSnapshot(), pool, fromBlock, toBlock);
    } catch {
      snapshot = null;
    }
  }
  if (snapshot) {
    logs = await queryLogs(snapshot.toBlock + 1n, snapshot.logs);
    usedSnapshot = true;
  } else {
    logs = await queryLogs(fromBlock);
  }

  async function verify(candidateLogs) {
    const leaves = [];
    let expectedPair = 0n;
    for (const log of orderedLogs(candidateLogs)) {
      if (log.args.pairIndex !== expectedPair) {
        throw new Error("The public note tree has a missing or repeated pair index.");
      }
      leaves.push(log.args.left.toString(), log.args.right.toString());
      expectedPair += 1n;
    }

    const [nextLeafIndex, currentRoot] = await Promise.all([
      readPoolValue("nextLeafIndex", [], { blockNumber: toBlock }),
      readPoolValue("currentRoot", [], { blockNumber: toBlock }),
    ]);
    if (BigInt(leaves.length) !== nextLeafIndex) {
      throw new Error("The public note events do not match the pool leaf count.");
    }
    if (leaves.length > 0) {
      const checked = await makeWitness(leaves, 0);
      if (BigInt(checked.root) !== currentRoot) {
        throw new Error("The rebuilt public note tree does not match the Base root.");
      }
    }
    return { leaves, nextLeafIndex, currentRoot };
  }

  let verified;
  try {
    verified = await verify(logs);
  } catch (error) {
    if (!usedSnapshot) throw error;
    logs = await queryLogs(fromBlock);
    verified = await verify(logs);
  }
  return {
    leaves: verified.leaves,
    currentRoot: verified.currentRoot.toString(),
    nextLeafIndex: verified.nextLeafIndex.toString(),
    toBlock: toBlock.toString(),
  };
}

export async function spendInputForNote(note, options = {}) {
  const tree = options.tree ?? await collectNoteTree(options);
  const makeWitness = options.treeWitness ?? treeWitness;
  const matches = [];
  for (let index = 0; index < tree.leaves.length; index += 1) {
    if (tree.leaves[index] === String(note.commitment)) matches.push(index);
  }
  if (matches.length !== 1) {
    throw new Error("The private note does not have one public commitment position.");
  }
  const witness = await makeWitness(tree.leaves, matches[0]);
  if (witness.root !== tree.currentRoot) {
    throw new Error("The note witness does not use the current verified Base root.");
  }
  return {
    note: {
      amount: note.amount,
      owner: note.owner,
      blinding: note.blinding,
      commitment: note.commitment,
      outputPosition: note.outputPosition,
    },
    spendRoot: witness.root,
    pathSiblings: witness.pathSiblings,
    pathBits: witness.pathBits,
  };
}
