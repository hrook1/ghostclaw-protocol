import { decodeEventLog, getAddress, parseAbiItem, toEventSelector } from "viem";
import { CONTRACTS, NETWORK } from "./protocol.mjs";

const NOTES_INSERTED = parseAbiItem(
  "event NotesInserted(uint256 indexed pairIndex,uint256 left,uint256 right,uint256 root)",
);
const NOTES_INSERTED_TOPIC = toEventSelector(NOTES_INSERTED);
// This range also works when the independent RPC uses Base's strict public limit.
const UPSTREAM_BLOCK_RANGE = 1_999n;
const UPSTREAM_CONCURRENCY = 2;
const UPSTREAM_RETRY_DELAYS_MS = [250, 500, 1_000, 2_000];
const MAX_UPSTREAM_BYTES = 32 * 1024 * 1024;
const MAX_TREE_PAIRS = 1 << 19;

function clientAddress(request) {
  const forwarded = String(request.headers?.["x-forwarded-for"] ?? "").split(",")[0].trim();
  return forwarded || request.socket?.remoteAddress || "unknown";
}

function reply(response, status, value, cache = false) {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(status, {
    "cache-control": cache ? "public, s-maxage=300, stale-while-revalidate=3600" : "no-store",
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function parseRpcQuantity(value, label) {
  if (!/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(String(value ?? ""))) {
    throw new Error(`${label} is invalid.`);
  }
  return BigInt(value);
}

async function rpc(fetchImpl, rpcUrl, method, params, id, wait) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      signal: AbortSignal.timeout(25_000),
    });
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_UPSTREAM_BYTES) {
      throw new Error("The Base read service response is too large.");
    }
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_UPSTREAM_BYTES) {
      throw new Error("The Base read service response is too large.");
    }
    const payload = text ? JSON.parse(text) : null;
    const limited = response.status === 429
      || Number(payload?.error?.code) === 429
      || Number(payload?.error?.code) === -32005;
    if (limited && attempt < UPSTREAM_RETRY_DELAYS_MS.length) {
      await wait(UPSTREAM_RETRY_DELAYS_MS[attempt]);
      continue;
    }
    if (
      !response.ok
      || payload?.jsonrpc !== "2.0"
      || payload.id !== id
      || payload.error
      || !("result" in payload)
    ) {
      throw new Error("The Base read service returned an invalid response.");
    }
    return payload.result;
  }
}

function normalizeLog(log) {
  if (
    getAddress(log.address) !== CONTRACTS.pool
    || log.removed === true
    || typeof log.data !== "string"
    || !Array.isArray(log.topics)
  ) {
    throw new Error("The Base read service returned an invalid note event.");
  }
  const decoded = decodeEventLog({
    abi: [NOTES_INSERTED],
    data: log.data,
    topics: log.topics,
    strict: true,
  });
  return {
    blockNumber: parseRpcQuantity(log.blockNumber, "The note block number").toString(),
    logIndex: parseRpcQuantity(log.logIndex, "The note log index").toString(),
    pairIndex: BigInt(decoded.args.pairIndex).toString(),
    left: BigInt(decoded.args.left).toString(),
    right: BigInt(decoded.args.right).toString(),
    root: BigInt(decoded.args.root).toString(),
  };
}

async function concurrentMap(values, limit, worker) {
  const output = new Array(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(values[index]);
    }
  }));
  return output;
}

export function createPublicNoteTreeHandler(options) {
  const rpcUrl = new URL(options.rpcUrl);
  if (rpcUrl.protocol !== "https:" || rpcUrl.username || rpcUrl.password || rpcUrl.hash) {
    throw new Error("The Base read service must use HTTPS.");
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const limiter = options.limiter;
  const wait = options.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));

  return async (request, response) => {
    if (request.method !== "GET") {
      reply(response, 404, { error: "not_found" });
      return;
    }
    try {
      if (limiter && !await limiter.preflight({ route: "/note-tree", ip: clientAddress(request) })) {
        reply(response, 429, { error: "rate_limit" });
        return;
      }
    } catch {
      reply(response, 503, { error: "rate_limit_unavailable" });
      return;
    }

    let stage = "block-number";
    try {
      let id = 1;
      const toBlock = parseRpcQuantity(
        await rpc(fetchImpl, rpcUrl, "eth_blockNumber", [], id++, wait),
        "The current Base block",
      );
      stage = "ranges";
      const ranges = [];
      for (
        let start = CONTRACTS.deploymentBlock;
        start <= toBlock;
        start += UPSTREAM_BLOCK_RANGE + 1n
      ) {
        ranges.push({
          start,
          end: start + UPSTREAM_BLOCK_RANGE > toBlock
            ? toBlock
            : start + UPSTREAM_BLOCK_RANGE,
          id: id++,
        });
      }
      stage = "event-logs";
      const batches = await concurrentMap(ranges, UPSTREAM_CONCURRENCY, ({ start, end, id: requestId }) => rpc(
        fetchImpl,
        rpcUrl,
        "eth_getLogs",
        [{
          address: CONTRACTS.pool,
          fromBlock: `0x${start.toString(16)}`,
          toBlock: `0x${end.toString(16)}`,
          topics: [NOTES_INSERTED_TOPIC],
        }],
        requestId,
        wait,
      ));
      const rawLogs = batches.flat();
      if (rawLogs.length > MAX_TREE_PAIRS) {
        throw new Error("The public note tree exceeds the contract capacity.");
      }
      stage = "event-validation";
      const logs = rawLogs.map(normalizeLog).sort((left, right) => {
        const blockOrder = BigInt(left.blockNumber) - BigInt(right.blockNumber);
        if (blockOrder !== 0n) return blockOrder < 0n ? -1 : 1;
        return Number(BigInt(left.logIndex) - BigInt(right.logIndex));
      });
      reply(response, 200, {
        version: 1,
        network: NETWORK,
        pool: CONTRACTS.pool,
        fromBlock: CONTRACTS.deploymentBlock.toString(),
        toBlock: toBlock.toString(),
        logs,
      }, true);
    } catch {
      console.warn(JSON.stringify({ event: "note_tree_unavailable", stage }));
      reply(response, 503, { error: "note_tree_unavailable" });
    }
  };
}
