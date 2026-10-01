import { createServer } from "node:http";
import { authorizeRelayPayload } from "./relay-policy.mjs";
import { MemoryRelayRateLimiter } from "./relay-rate-limiter.mjs";
import { simulateSponsorship } from "./sponsor-simulation.mjs";
import { evaluateSponsorship } from "./sponsorship-policy.mjs";

const MAX_BODY_BYTES = 128 * 1024;
const MAX_UPSTREAM_BYTES = 2 * 1024 * 1024;
const UPSTREAM_URL = "https://api.g.alchemy.com/v2";

function reply(response, status, body) {
  const data = JSON.stringify(body);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data),
  });
  response.end(data);
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

async function readJson(request) {
  if (request.body !== undefined && request.body !== null) {
    const raw = Buffer.isBuffer(request.body)
      ? request.body
      : Buffer.from(typeof request.body === "string" ? request.body : JSON.stringify(request.body));
    if (raw.length > MAX_BODY_BYTES) throw new Error("REQUEST_TOO_LARGE");
    return typeof request.body === "object" && !Buffer.isBuffer(request.body)
      ? request.body
      : JSON.parse(raw.toString("utf8"));
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function readUpstream(response) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body ?? []) {
    bytes += chunk.length;
    if (bytes > MAX_UPSTREAM_BYTES) throw new Error("UPSTREAM_TOO_LARGE");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function redact(value, secrets) {
  if (typeof value === "string") {
    return secrets.reduce(
      (result, secret) => secret ? result.split(secret).join("[REDACTED]") : result,
      value,
    );
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, secrets));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item, secrets)]));
  }
  return value;
}

function clientAddress(request) {
  const forwarded = String(
    request.headers?.["x-vercel-forwarded-for"]
    ?? request.headers?.["x-forwarded-for"]
    ?? request.headers?.["x-real-ip"]
    ?? "",
  ).split(",")[0].trim();
  return forwarded || request.socket?.remoteAddress || "unknown";
}

function requestCost(method, acceptedCalls = []) {
  if (method === "wallet_getCallsStatus") return 1;
  const proofCall = acceptedCalls.some((call) => (
    call.functionName === "deposit"
    || call.functionName === "confidentialTransfer"
    || call.functionName === "withdraw"
  ));
  return proofCall ? 10 : Math.max(1, acceptedCalls.length);
}

function recordSecurityEvent(event, details = {}) {
  console.warn(JSON.stringify({ event, ...details }));
}

export function createGhostClawRelayHandler(options) {
  const {
    policyId,
    undelegationPolicyId = policyId,
    apiKey,
    fetchImpl = fetch,
    upstreamUrl = UPSTREAM_URL,
  } = options;
  const limiter = options.limiter ?? new MemoryRelayRateLimiter();

  return async (request, response, route = request.url) => {
    if (request.method === "GET" && route === "/health") {
      try {
        if (typeof limiter.health === "function") await limiter.health();
        reply(response, 200, { status: "ready" });
      } catch {
        reply(response, 503, { status: "unavailable" });
      }
      return;
    }
    if (
      request.method !== "POST"
      || (route !== "/rpc" && route !== "/alchemy/sponsor")
    ) {
      reply(response, 404, { error: "not_found" });
      return;
    }
    if (!String(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
      reply(response, 415, { error: "json_required" });
      return;
    }
    const ip = clientAddress(request);
    try {
      if (!await limiter.preflight({ route, ip })) {
        reply(response, 429, { error: "rate_limit" });
        return;
      }
    } catch {
      reply(response, 503, { error: "rate_limit_unavailable" });
      return;
    }

    let payload;
    try {
      payload = await readJson(request);
    } catch (error) {
      reply(response, error?.message === "REQUEST_TOO_LARGE" ? 413 : 400, { error: "invalid_request" });
      return;
    }

    if (route === "/alchemy/sponsor") {
      let result = evaluateSponsorship(payload, policyId, options.sponsorToken);
      if (result.approved) {
        let stage = "rate-limit";
        try {
          const allowed = await limiter.allow({
            route,
            method: "sponsor",
            ip,
            sender: result.sender,
            cost: requestCost("sponsor", result.acceptedCalls),
          });
          if (!allowed) result = { approved: false, reason: "The sponsor rate limit was reached." };
          else if (options.simulationRpcUrl) {
            stage = "simulation";
            await simulateSponsorship(result, {
              rpcUrl: options.simulationRpcUrl,
              fetchImpl: options.simulationFetchImpl,
            });
          }
        } catch {
          recordSecurityEvent("sponsor_safety_unavailable", { stage });
          result = { approved: false, reason: "The sponsor safety check was unavailable." };
        }
      }
      if (!result.approved) {
        recordSecurityEvent("sponsor_rejected", { reason: result.reason });
      }
      reply(response, 200, { approved: result.approved });
      return;
    }

    let authorized;
    try {
      authorized = await authorizeRelayPayload(
        payload,
        policyId,
        options.sponsorToken,
        undelegationPolicyId,
      );
    } catch (error) {
      reply(response, 200, rpcError(payload?.id, -32602, error?.message ?? "Relay policy rejected the call."));
      return;
    }
    try {
      const allowed = await limiter.allow({
        route,
        method: payload.method,
        ip,
        sender: authorized.sender,
        cost: requestCost(payload.method, authorized.acceptedCalls),
      });
      if (!allowed) {
        reply(response, 429, rpcError(payload.id, -32005, "The GhostClaw relay rate limit was reached."));
        return;
      }
    } catch {
      reply(response, 503, rpcError(payload.id, -32603, "The relay safety service is unavailable."));
      return;
    }

    try {
      const upstream = await fetchImpl(upstreamUrl, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(authorized.payload),
        signal: AbortSignal.timeout(30_000),
      });
      const upstreamPayload = await readUpstream(upstream);
      if (
        !upstream.ok
        || !upstreamPayload
        || typeof upstreamPayload !== "object"
        || Array.isArray(upstreamPayload)
        || upstreamPayload.id !== authorized.payload.id
      ) {
        throw new Error("The upstream wallet service returned an invalid response.");
      }
      reply(response, 200, redact(upstreamPayload, [
        apiKey,
        policyId,
        undelegationPolicyId,
        options.sponsorToken,
      ]));
    } catch {
      reply(response, 502, rpcError(payload.id, -32603, "The sponsored wallet service is unavailable."));
    }
  };
}

export function createGhostClawRelay(options) {
  const handler = createGhostClawRelayHandler(options);
  const server = createServer(handler);
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;
  return server;
}
