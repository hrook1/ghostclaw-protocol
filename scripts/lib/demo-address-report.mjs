import { createHmac } from "node:crypto";
import {
  formatEther,
  getAddress,
} from "viem";
import {
  CONTRACTS,
  NETWORK,
  formatTokenAmount,
  poolAbi,
  tokenAbi,
} from "./protocol.mjs";

const REPORT_TTL_SECONDS = 7 * 24 * 60 * 60;
const TRANSACTION_HASH = /^0x[0-9a-f]{64}$/i;
const JOB_ID = /^[0-9a-f]{64}$/;
const BLOCKSCOUT_URL = "https://base-sepolia.blockscout.com/api/v2/";

function hostedSecret(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new Error("GHOSTCLAW_DEMO_MERCHANT_SECRET must contain 32 base64url bytes.");
  }
  const secret = Buffer.from(value, "base64url");
  if (secret.length !== 32) {
    secret.fill(0);
    throw new Error("GHOSTCLAW_DEMO_MERCHANT_SECRET must contain 32 base64url bytes.");
  }
  return secret;
}

function compactTransactions(payload, account) {
  const items = Array.isArray(payload?.items) ? payload.items.slice(0, 10) : [];
  return items.flatMap((item) => {
    if (!TRANSACTION_HASH.test(String(item?.hash ?? ""))) return [];
    let from;
    let to;
    try {
      from = getAddress(item.from?.hash ?? item.from ?? "");
      to = item.to?.hash || item.to ? getAddress(item.to?.hash ?? item.to) : null;
    } catch {
      return [];
    }
    return [{
      hash: item.hash,
      blockNumber: String(item.block_number ?? item.blockNumber ?? ""),
      timestamp: item.timestamp ?? null,
      direction: from === account ? "out" : to === account ? "in" : "related",
      from,
      to,
      status: item.status ?? null,
    }];
  });
}

async function recentTransactions(address, fetchImpl) {
  const url = new URL(`addresses/${address}/transactions`, BLOCKSCOUT_URL);
  url.searchParams.set("filter", "validated");
  const response = await fetchImpl(url, {
    redirect: "manual",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok || (response.status >= 300 && response.status < 400)) {
    throw new Error("The public transaction index is unavailable.");
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > 512 * 1024) {
    throw new Error("The public transaction index response is too large.");
  }
  return compactTransactions(JSON.parse(text), address);
}

export async function buildAddressReport(addressValue, dependencies) {
  const address = getAddress(addressValue);
  const client = dependencies.publicClient;
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const [
    ethBalance,
    transactionCount,
    bytecode,
    blockNumber,
    publicGusdBalance,
    ghostclawOwner,
    indexedActivity,
  ] = await Promise.all([
    client.getBalance({ address }),
    client.getTransactionCount({ address }),
    client.getBytecode({ address }),
    client.getBlockNumber(),
    client.readContract({ address: CONTRACTS.token, abi: tokenAbi, functionName: "balanceOf", args: [address] }),
    client.readContract({ address: CONTRACTS.pool, abi: poolAbi, functionName: "ownerOf", args: [address] }),
    recentTransactions(address, fetchImpl).catch(() => null),
  ]);
  const accountType = bytecode && bytecode !== "0x" ? "contract" : "externally-owned-account";
  const registered = BigInt(ghostclawOwner) !== 0n;
  return {
    version: 1,
    service: "ghostclaw-address-report",
    network: NETWORK,
    address,
    generatedAt: new Date().toISOString(),
    observedAtBlock: blockNumber.toString(),
    overview: {
      accountType,
      publicTransactionCount: Number(transactionCount),
      publicEthBalance: formatEther(ethBalance),
      publicTestGusdBalance: formatTokenAmount(publicGusdBalance),
      ghostclawRegistered: registered,
    },
    recentPublicTransactions: indexedActivity ?? [],
    indexStatus: indexedActivity === null ? "temporarily-unavailable" : "available",
    interpretation: registered
      ? "This address has a GhostClaw identity on Base Sepolia. Public data cannot reveal its private note balance."
      : "This address has no GhostClaw identity on the current Base Sepolia pool.",
    privacyBoundary:
      "This report uses public Base data. It cannot read GhostClaw note balances or confidential payment amounts.",
  };
}

export class DemoReportStore {
  constructor({ redis, secret }) {
    this.redis = redis;
    this.secret = secret;
  }

  jobId(transactionHash, address) {
    if (!TRANSACTION_HASH.test(String(transactionHash ?? ""))) {
      throw new Error("The report settlement has no valid transaction hash.");
    }
    const key = hostedSecret(this.secret);
    try {
      return createHmac("sha256", key)
        .update("GHOSTCLAW_DEMO_ADDRESS_REPORT_JOB_V1", "utf8")
        .update(transactionHash.toLowerCase(), "utf8")
        .update(getAddress(address).toLowerCase(), "utf8")
        .digest("hex");
    } finally {
      key.fill(0);
    }
  }

  key(jobId) {
    if (!JOB_ID.test(String(jobId ?? ""))) {
      throw new Error("The report job identifier is invalid.");
    }
    return `ghostclaw:demo:address-report:${jobId}:v1`;
  }

  async get(jobId) {
    const encoded = await this.redis.get(this.key(jobId));
    if (encoded === null) return null;
    if (typeof encoded !== "string" || encoded.length > 1024 * 1024) {
      throw new Error("The stored address report is invalid.");
    }
    let job;
    try {
      job = JSON.parse(encoded);
    } catch {
      throw new Error("The stored address report is invalid.");
    }
    if (job?.version !== 1 || job.jobId !== jobId || job.status !== "ready" || !job.report) {
      throw new Error("The stored address report is invalid.");
    }
    return job;
  }

  async save(job) {
    if (job?.jobId !== this.jobId(job.transactionHash, job.report?.address)) {
      throw new Error("The address report does not match its settlement.");
    }
    await this.redis.set(this.key(job.jobId), JSON.stringify(job), { ex: REPORT_TTL_SECONDS });
    return job;
  }
}

function publicRequestUrl(request) {
  if (/^https?:\/\//i.test(String(request.url ?? ""))) return new URL(request.url);
  const forwardedHost = String(request.headers?.["x-forwarded-host"] ?? request.headers?.host ?? "").split(",")[0].trim();
  const forwardedProto = String(request.headers?.["x-forwarded-proto"] ?? "https").split(",")[0].trim();
  if (!forwardedHost || !["https", "http"].includes(forwardedProto)) {
    throw new Error("The public request URL is unavailable.");
  }
  return new URL(String(request.url ?? "/"), `${forwardedProto}://${forwardedHost}`);
}

function sendJson(response, status, value, headers = {}) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    ...headers,
  });
  response.end(body);
}

function deliveryUrl(source, jobId) {
  const url = new URL(source);
  url.search = "";
  url.searchParams.set("job", jobId);
  return url.toString();
}

function requestIp(request) {
  return String(
    request.headers?.["x-forwarded-for"]
    ?? request.headers?.["x-real-ip"]
    ?? request.socket?.remoteAddress
    ?? "unknown",
  ).split(",")[0].trim();
}

export function createAddressReportHandler({
  gate,
  store,
  buildReport,
  merchant,
  price = "1",
  limiter = null,
  logError = console.error,
}) {
  return async function addressReportHandler(request, response) {
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "method_not_allowed" }, { allow: "GET" });
      return;
    }
    let stage = "request-validation";
    try {
      const url = publicRequestUrl(request);
      stage = "rate-limit";
      if (limiter && !await limiter.preflight({ route: "/demo/address-report", ip: requestIp(request) })) {
        sendJson(response, 429, { error: "rate_limited" }, { "retry-after": "60" });
        return;
      }
      if (url.searchParams.get("status") === "1") {
        sendJson(response, 200, {
          status: "ready",
          service: "ghostclaw-address-report",
          network: NETWORK,
          merchant,
          price,
        });
        return;
      }
      const requestedJob = url.searchParams.get("job");
      if (requestedJob !== null) {
        stage = "delivery-read";
        const job = await store.get(requestedJob);
        sendJson(response, job ? 200 : 404, job ?? { error: "report_not_found" });
        return;
      }
      const address = getAddress(url.searchParams.get("address") ?? "");
      stage = "merchant-authorization";
      const authorization = await gate({ url: url.toString(), headers: request.headers });
      if (!authorization.paid) {
        sendJson(response, authorization.status, authorization.body, authorization.headers);
        return;
      }
      const transactionHash = authorization.settlement.transactionHash;
      const jobId = store.jobId(transactionHash, address);
      stage = "job-read";
      let job = await store.get(jobId);
      if (!job) {
        stage = "report-build";
        const report = await buildReport(address);
        stage = "job-save";
        job = await store.save({
          version: 1,
          jobId,
          status: "ready",
          transactionHash,
          createdAt: new Date().toISOString(),
          report,
        });
      }
      stage = "response";
      sendJson(response, 200, {
        ...job,
        deliveryUrl: deliveryUrl(url, jobId),
      });
    } catch (error) {
      const failureStage = String(error?.ghostclawStage ?? stage);
      logError(JSON.stringify({ event: "demo_address_report_failed", stage: failureStage }));
      const retryable = error?.code === "GHOSTCLAW_MERCHANT_BUSY"
        || failureStage.startsWith("merchant-native-")
        || [
          "merchant-note-import",
          "merchant-note-inspector",
          "delivery-read",
          "job-read",
          "report-build",
          "job-save",
        ].includes(failureStage);
      const status = retryable ? 503 : 400;
      sendJson(response, status, {
        error: error?.code === "GHOSTCLAW_MERCHANT_BUSY"
          ? "merchant_temporarily_busy"
          : status === 503
            ? "report_temporarily_unavailable"
            : "address_report_failed",
      }, status === 503 ? { "retry-after": "2" } : {});
    }
  };
}
