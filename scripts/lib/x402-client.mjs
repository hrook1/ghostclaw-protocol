import { createHash } from "node:crypto";
import { getAddress } from "viem";
import {
  authorizePayment,
  markPaymentDelivered,
  recordedPayment,
  recordPaymentUsage,
} from "./agent-policy.mjs";
import { settleWithLocalRuntime } from "./local-runtime.mjs";
import { CONTRACTS, NETWORK, parseTokenAmount } from "./protocol.mjs";

export const GHOSTCLAW_X402_SCHEME = "ghostclaw-confidential-x402-v2";
const QUOTE_TTL_MS = 10 * 60 * 1_000;
const MAX_HEADER_BYTES = 64 * 1024;
const MAX_REQUEST_BYTES = 1024 * 1024;
const paymentMetadata = new WeakMap();

export class GhostClawFetchError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "GhostClawFetchError";
    this.code = code;
    Object.assign(this, details);
  }
}

function checkedUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new GhostClawFetchError("GHOSTCLAW_INVALID_URL", "The x402 service URL is invalid.");
  }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw new GhostClawFetchError("GHOSTCLAW_TLS_REQUIRED", "The x402 service URL must use HTTPS.");
  }
  if (url.username || url.password || url.hash) {
    throw new GhostClawFetchError(
      "GHOSTCLAW_INVALID_URL",
      "The x402 service URL contains unsupported credentials or a fragment.",
    );
  }
  return url;
}

function decodeHeader(value) {
  if (!value || value.length > Math.ceil(MAX_HEADER_BYTES * 4 / 3) + 4) {
    throw new GhostClawFetchError(
      "GHOSTCLAW_INVALID_REQUIREMENT",
      "The service did not return a valid PAYMENT-REQUIRED header.",
    );
  }
  if (!/^(?:[A-Za-z0-9+/_-]{4})*(?:[A-Za-z0-9+/_-]{2}==|[A-Za-z0-9+/_-]{3}=)?$/.test(value)) {
    throw new GhostClawFetchError(
      "GHOSTCLAW_INVALID_REQUIREMENT",
      "The PAYMENT-REQUIRED header does not use base64.",
    );
  }
  const bytes = Buffer.from(value.replaceAll("-", "+").replaceAll("_", "/"), "base64");
  if (bytes.length === 0 || bytes.length > MAX_HEADER_BYTES) {
    throw new GhostClawFetchError(
      "GHOSTCLAW_INVALID_REQUIREMENT",
      "The PAYMENT-REQUIRED header has an invalid size.",
    );
  }
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new GhostClawFetchError(
      "GHOSTCLAW_INVALID_REQUIREMENT",
      "The PAYMENT-REQUIRED header does not contain valid JSON.",
    );
  }
}

function requirementList(payload) {
  if (Array.isArray(payload?.accepts)) return payload.accepts;
  if (Array.isArray(payload?.paymentRequirements)) return payload.paymentRequirements;
  return [payload];
}

function requirementAmount(requirement, payload) {
  if (typeof requirement.amount === "string" && requirement.amount.includes(".")) {
    return parseTokenAmount(requirement.amount);
  }
  if (typeof requirement.amount === "string" && /^[0-9]+$/.test(requirement.amount)) {
    return payload?.x402Version === 2 ? BigInt(requirement.amount) : parseTokenAmount(requirement.amount);
  }
  if (typeof requirement.maxAmountRequired === "string" && /^[1-9][0-9]*$/.test(requirement.maxAmountRequired)) {
    return BigInt(requirement.maxAmountRequired);
  }
  throw new GhostClawFetchError(
    "GHOSTCLAW_INVALID_REQUIREMENT",
    "The GhostClaw x402 amount is invalid.",
  );
}

export function validateX402Requirement(payload, sourceUrl) {
  const requirement = requirementList(payload).find((item) => item?.scheme === GHOSTCLAW_X402_SCHEME);
  if (!requirement) {
    throw new GhostClawFetchError(
      "GHOSTCLAW_SCHEME_UNAVAILABLE",
      "The service does not offer the GhostClaw x402 scheme.",
    );
  }
  const extra = requirement.extra?.ghostclaw ?? requirement.extra ?? {};
  const network = requirement.network;
  if (network !== NETWORK && network !== "eip155:84532") {
    throw new GhostClawFetchError(
      "GHOSTCLAW_NETWORK_MISMATCH",
      "The GhostClaw x402 requirement uses another network.",
    );
  }
  const merchant = getAddress(requirement.merchant ?? requirement.payTo);
  const asset = getAddress(requirement.asset);
  const pool = getAddress(requirement.pool ?? extra.pool);
  if (asset !== CONTRACTS.token) {
    throw new GhostClawFetchError("GHOSTCLAW_ASSET_MISMATCH", "The requirement uses another asset.");
  }
  if (pool !== CONTRACTS.pool) {
    throw new GhostClawFetchError("GHOSTCLAW_POOL_MISMATCH", "The requirement uses another pool.");
  }
  const merchantNoteKey = requirement.merchantNoteEncryptionPublicKey
    ?? requirement["merchant-note-key"]
    ?? extra.noteEncryptionPublicKey;
  if (typeof merchantNoteKey !== "string" || merchantNoteKey.length < 40 || merchantNoteKey.length > 512) {
    throw new GhostClawFetchError(
      "GHOSTCLAW_INVALID_REQUIREMENT",
      "The requirement has no valid merchant note key.",
    );
  }
  const url = checkedUrl(sourceUrl);
  if (extra.origin && new URL(extra.origin).origin !== url.origin) {
    throw new GhostClawFetchError(
      "GHOSTCLAW_ORIGIN_MISMATCH",
      "The requirement is bound to another service origin.",
    );
  }
  const suppliedExpiry = Date.parse(requirement.expiresAt ?? extra.expiresAt ?? "");
  const expiresAt = Number.isFinite(suppliedExpiry)
    ? Math.min(suppliedExpiry, Date.now() + QUOTE_TTL_MS)
    : Date.now() + QUOTE_TTL_MS;
  if (expiresAt <= Date.now()) {
    throw new GhostClawFetchError("GHOSTCLAW_QUOTE_EXPIRED", "The x402 requirement has expired.");
  }
  return {
    merchant,
    asset,
    pool,
    amount: requirementAmount(requirement, payload).toString(),
    merchantNoteKey,
    origin: url.origin,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

async function replayableRequest(input, init = {}) {
  const request = new Request(input, init);
  const url = checkedUrl(request.url);
  const method = request.method.toUpperCase();
  if (["CONNECT", "TRACE"].includes(method)) {
    throw new GhostClawFetchError("GHOSTCLAW_METHOD_REJECTED", "The HTTP method is not supported.");
  }
  const headers = new Headers(request.headers);
  if (headers.has("payment-signature") || headers.has("x-payment")) {
    throw new GhostClawFetchError(
      "GHOSTCLAW_PAYMENT_HEADER_REJECTED",
      "The caller cannot supply a payment signature.",
    );
  }
  let body = null;
  if (method !== "GET" && method !== "HEAD") {
    const bytes = Buffer.from(await request.arrayBuffer());
    if (bytes.length > MAX_REQUEST_BYTES) {
      bytes.fill(0);
      throw new GhostClawFetchError(
        "GHOSTCLAW_REQUEST_TOO_LARGE",
        "The paid request body exceeds 1 MiB.",
      );
    }
    body = bytes;
  }
  return { url, method, headers, body };
}

function requestFingerprint(request, requirementBase64) {
  const headerPairs = [...request.headers.entries()]
    .filter(([name]) => name.toLowerCase() !== "payment-signature")
    .sort(([left], [right]) => left.localeCompare(right));
  const bodyHash = createHash("sha256").update(request.body ?? Buffer.alloc(0)).digest("hex");
  return createHash("sha256").update(JSON.stringify({
    url: request.url.toString(),
    method: request.method,
    headers: headerPairs,
    bodyHash,
    requirementBase64,
  })).digest("hex");
}

function requestInit(request, paymentSignature) {
  const headers = new Headers(request.headers);
  if (paymentSignature) headers.set("payment-signature", paymentSignature);
  return {
    method: request.method,
    headers,
    body: request.body,
    redirect: "manual",
  };
}

function checkedSettlement(value, requirement) {
  if (
    value?.scheme !== GHOSTCLAW_X402_SCHEME
    || getAddress(value.merchant) !== requirement.merchant
    || typeof value.transactionHash !== "string"
  ) {
    throw new GhostClawFetchError(
      "GHOSTCLAW_SETTLEMENT_MISMATCH",
      "The local settlement response does not match the requirement.",
    );
  }
  return value;
}

export async function fetchDetailed(input, init = {}, options = {}) {
  const request = await replayableRequest(input, init);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const first = await fetchImpl(request.url, {
    ...requestInit(request),
    signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
  });
  if (first.status !== 402) return { response: first, payment: null };

  const encoded = first.headers.get("payment-required");
  const requirement = validateX402Requirement(decodeHeader(encoded), request.url.toString());
  const fingerprint = requestFingerprint(request, encoded);
  let settlement = await recordedPayment(fingerprint);
  if (!settlement) {
    let authorization;
    try {
      authorization = await authorizePayment({ ...requirement, fingerprint });
    } catch (error) {
      if (error?.code === "GHOSTCLAW_BUDGET_EXCEEDED") {
        throw new GhostClawFetchError(error.code, error.message, {
          approvalId: error.approvalId,
          reasons: error.reasons,
        });
      }
      throw error;
    }
    settlement = checkedSettlement(await (options.settle ?? settleWithLocalRuntime)({
      merchant: requirement.merchant,
      merchantNoteKey: requirement.merchantNoteKey,
      amount: requirement.amount,
      requirementBase64: encoded,
    }), requirement);
    await recordPaymentUsage({
      merchant: requirement.merchant,
      origin: requirement.origin,
      amount: requirement.amount,
      fingerprint,
      approvalId: authorization.approvalId,
    }, settlement);
  } else {
    settlement = checkedSettlement(settlement, requirement);
  }
  const signature = Buffer.from(JSON.stringify(settlement), "utf8").toString("base64");
  const response = await fetchImpl(request.url, {
    ...requestInit(request, signature),
    signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
  });
  if (response.status >= 300 && response.status < 400) {
    throw new GhostClawFetchError(
      "GHOSTCLAW_REDIRECT_REJECTED",
      "The paid service attempted a redirect.",
    );
  }
  if (response.status === 402) {
    throw new GhostClawFetchError(
      "GHOSTCLAW_SETTLEMENT_REJECTED",
      "The paid service rejected the GhostClaw settlement response.",
    );
  }
  if (!response.ok) {
    throw new GhostClawFetchError(
      "GHOSTCLAW_RESOURCE_DELIVERY_FAILED",
      "The payment settled, but the service did not deliver the resource. Retry the same request.",
      { status: response.status },
    );
  }
  await markPaymentDelivered(fingerprint);
  const payment = {
    scheme: GHOSTCLAW_X402_SCHEME,
    merchant: requirement.merchant,
    origin: requirement.origin,
    transactionHash: settlement.transactionHash,
  };
  paymentMetadata.set(response, payment);
  return { response, payment };
}

export async function ghostclawFetch(input, init = {}, options = {}) {
  return (await fetchDetailed(input, init, options)).response;
}

export function paymentForResponse(response) {
  return paymentMetadata.get(response) ?? null;
}
