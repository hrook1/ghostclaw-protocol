import { createFacilitatorHandler } from "./facilitator-server.mjs";
import { SharedRelayRateLimiter } from "./relay-rate-limiter.mjs";
import { rateLimitEnvironment } from "./vercel-relay.mjs";

let handler;

function requiredSecret(name) {
  const value = String(process.env[name] ?? "").trim();
  if (value.length < 32) throw new Error(`${name} must contain at least 32 characters.`);
  return value;
}

export function handleVercelFacilitator(request, response) {
  try {
    const rateLimit = rateLimitEnvironment();
    handler ??= createFacilitatorHandler({
      limiter: new SharedRelayRateLimiter({
        url: rateLimit.url,
        token: rateLimit.token,
        keySecret: requiredSecret("GHOSTCLAW_RATE_LIMIT_KEY_SECRET"),
      }),
    });
  } catch {
    const body = JSON.stringify({ error: "facilitator_unavailable" });
    response.writeHead(503, {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(body),
    });
    response.end(body);
    return;
  }
  return handler(request, response);
}
