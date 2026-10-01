import { createGhostClawRelayHandler } from "./relay-server.mjs";
import { SharedRelayRateLimiter } from "./relay-rate-limiter.mjs";
import { PUBLIC_RPC_URL } from "./protocol.mjs";

let handler;

function requiredEnvironment(name, environment = process.env) {
  const value = String(environment[name] ?? "").trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function requiredSecret(name, environment = process.env) {
  const value = requiredEnvironment(name, environment);
  if (value.length < 32) throw new Error(`${name} must contain at least 32 characters.`);
  return value;
}

export function rateLimitEnvironment(environment = process.env) {
  const url = String(
    environment.GHOSTCLAW_RATE_LIMIT_REDIS_URL
    ?? environment.UPSTASH_REDIS_REST_KV_REST_API_URL
    ?? environment.KV_REST_API_URL
    ?? environment.UPSTASH_REDIS_REST_URL
    ?? "",
  ).trim();
  const token = String(
    environment.GHOSTCLAW_RATE_LIMIT_REDIS_TOKEN
    ?? environment.UPSTASH_REDIS_REST_KV_REST_API_TOKEN
    ?? environment.KV_REST_API_TOKEN
    ?? environment.UPSTASH_REDIS_REST_TOKEN
    ?? "",
  ).trim();
  if (!url) throw new Error("The shared rate-limit Redis URL is required.");
  if (!token) throw new Error("The shared rate-limit Redis token is required.");
  return { url, token };
}

export function handleVercelRelay(request, response, route) {
  try {
    const rateLimit = rateLimitEnvironment();
    handler ??= createGhostClawRelayHandler({
      apiKey: requiredEnvironment("ALCHEMY_API_KEY"),
      policyId: requiredEnvironment("ALCHEMY_AGENT_GAS_POLICY_ID"),
      undelegationPolicyId: requiredEnvironment("ALCHEMY_UNDELEGATION_GAS_POLICY_ID"),
      limiter: new SharedRelayRateLimiter({
        url: rateLimit.url,
        token: rateLimit.token,
        keySecret: requiredSecret("GHOSTCLAW_RATE_LIMIT_KEY_SECRET"),
      }),
      simulationRpcUrl: process.env.GHOSTCLAW_SIMULATION_RPC_URL?.trim() || PUBLIC_RPC_URL,
      sponsorToken: requiredSecret("GHOSTCLAW_SPONSOR_CALLBACK_TOKEN"),
    });
  } catch {
    const body = JSON.stringify({ error: "relay_unavailable" });
    response.writeHead(503, {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(body),
    });
    response.end(body);
    return;
  }
  return handler(request, response, route);
}
