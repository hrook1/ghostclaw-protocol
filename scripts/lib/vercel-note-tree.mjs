import { SharedRelayRateLimiter } from "./relay-rate-limiter.mjs";
import { rateLimitEnvironment } from "./vercel-relay.mjs";
import { createPublicNoteTreeHandler } from "./note-tree-service.mjs";

let handler;

function requiredSecret(name) {
  const value = String(process.env[name] ?? "").trim();
  if (value.length < 32) throw new Error(`${name} must contain at least 32 characters.`);
  return value;
}

export function handleVercelNoteTree(request, response) {
  try {
    const rateLimit = rateLimitEnvironment();
    const rpcUrl = String(process.env.GHOSTCLAW_SIMULATION_RPC_URL ?? "").trim();
    if (!rpcUrl) throw new Error("GHOSTCLAW_SIMULATION_RPC_URL is required.");
    handler ??= createPublicNoteTreeHandler({
      rpcUrl,
      limiter: new SharedRelayRateLimiter({
        url: rateLimit.url,
        token: rateLimit.token,
        keySecret: requiredSecret("GHOSTCLAW_RATE_LIMIT_KEY_SECRET"),
      }),
    });
  } catch {
    console.warn(JSON.stringify({ event: "note_tree_unavailable", stage: "configuration" }));
    const body = JSON.stringify({ error: "note_tree_unavailable" });
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
