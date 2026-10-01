import { getAddress } from "viem";
import { publicClient, readPool } from "./alchemy-adapter.mjs";
import { validatePublicSettlement } from "./settlement.mjs";

const MAX_BODY_BYTES = 256 * 1024;
const MAX_HEADER_BYTES = 128 * 1024;

function reply(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

async function readJson(request) {
  if (request.body !== undefined && request.body !== null) {
    const structured = typeof request.body === "object" && !Buffer.isBuffer(request.body);
    const bytes = Buffer.isBuffer(request.body)
      ? request.body
      : Buffer.from(typeof request.body === "string" ? request.body : JSON.stringify(request.body));
    if (bytes.length === 0 || bytes.length > MAX_BODY_BYTES) throw new Error("invalid_body");
    return structured ? request.body : JSON.parse(bytes.toString("utf8"));
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("invalid_body");
    chunks.push(chunk);
  }
  if (size === 0) throw new Error("invalid_body");
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function decodeBase64Json(value, label) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > Math.ceil(MAX_HEADER_BYTES * 4 / 3) + 4
    || !/^(?:[A-Za-z0-9+/_-]{4})*(?:[A-Za-z0-9+/_-]{2}==|[A-Za-z0-9+/_-]{3}=)?$/.test(value)
  ) {
    throw new Error(`${label}_invalid`);
  }
  const bytes = Buffer.from(value.replaceAll("-", "+").replaceAll("_", "/"), "base64");
  if (bytes.length === 0 || bytes.length > MAX_HEADER_BYTES) throw new Error(`${label}_invalid`);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label}_invalid`);
  } finally {
    bytes.fill(0);
  }
}

function clientAddress(request) {
  return String(
    request.headers?.["x-vercel-forwarded-for"]
    ?? request.headers?.["x-forwarded-for"]
    ?? request.headers?.["x-real-ip"]
    ?? request.socket?.remoteAddress
    ?? "unknown",
  ).split(",")[0].trim();
}

export function createFacilitatorHandler(options = {}) {
  const limiter = options.limiter;
  const verify = options.validatePublicSettlement ?? validatePublicSettlement;
  return async function facilitator(request, response) {
    if (request.method !== "POST") {
      reply(response, 404, { error: "not_found" });
      return;
    }
    if (!String(request.headers?.["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
      reply(response, 415, { error: "json_required" });
      return;
    }
    const ip = clientAddress(request);
    try {
      if (limiter && !await limiter.preflight({ route: "/facilitator/verify", ip })) {
        reply(response, 429, { error: "rate_limit" });
        return;
      }
    } catch {
      reply(response, 503, { error: "rate_limit_unavailable" });
      return;
    }
    try {
      const input = await readJson(request);
      const merchant = getAddress(input.merchant);
      const payment = decodeBase64Json(input.paymentSignature, "payment_signature");
      if (getAddress(payment.merchant) !== merchant) {
        throw new Error("merchant_mismatch");
      }
      if (limiter && !await limiter.allow({
        route: "/facilitator/verify",
        method: "verify",
        ip,
        sender: merchant,
        cost: 2,
      })) {
        reply(response, 429, { error: "rate_limit" });
        return;
      }
      const result = await verify({
        payload: payment,
        account: merchant,
        publicClient: options.publicClient ?? publicClient,
        readPool: options.readPool ?? readPool,
        confirmations: options.confirmations ?? 1,
      });
      reply(response, 200, { ...result, verification: "public-chain" });
    } catch {
      reply(response, 402, { error: "payment_not_verified" });
    }
  };
}
