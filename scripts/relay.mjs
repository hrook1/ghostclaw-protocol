#!/usr/bin/env node

import { createGhostClawRelay } from "./lib/relay-server.mjs";
import { SharedRelayRateLimiter } from "./lib/relay-rate-limiter.mjs";
import { PUBLIC_RPC_URL } from "./lib/protocol.mjs";

const policyId = String(process.env.ALCHEMY_AGENT_GAS_POLICY_ID ?? "").trim();
const undelegationPolicyId = String(
  process.env.ALCHEMY_UNDELEGATION_GAS_POLICY_ID ?? "",
).trim();
const apiKey = String(process.env.ALCHEMY_API_KEY ?? "").trim();
const port = Number(process.env.PORT ?? 8787);

if (!/^[A-Za-z0-9_-]{6,}$/.test(policyId)) {
  throw new Error("ALCHEMY_AGENT_GAS_POLICY_ID is required.");
}
if (!/^[A-Za-z0-9_-]{6,}$/.test(undelegationPolicyId)) {
  throw new Error("ALCHEMY_UNDELEGATION_GAS_POLICY_ID is required.");
}
if (apiKey.length < 8) throw new Error("ALCHEMY_API_KEY is required.");
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be a valid TCP port.");
}

const redisUrl = String(process.env.GHOSTCLAW_RATE_LIMIT_REDIS_URL ?? "").trim();
const redisToken = String(process.env.GHOSTCLAW_RATE_LIMIT_REDIS_TOKEN ?? "").trim();
const rateLimitKeySecret = String(process.env.GHOSTCLAW_RATE_LIMIT_KEY_SECRET ?? "").trim();
const sponsorToken = String(process.env.GHOSTCLAW_SPONSOR_CALLBACK_TOKEN ?? "").trim();
if (!redisUrl || !redisToken || rateLimitKeySecret.length < 32) {
  throw new Error("The shared relay rate-limit store and key secret are required.");
}
if (sponsorToken.length < 32) {
  throw new Error("GHOSTCLAW_SPONSOR_CALLBACK_TOKEN must contain at least 32 characters.");
}

const server = createGhostClawRelay({
  policyId,
  undelegationPolicyId,
  apiKey,
  limiter: new SharedRelayRateLimiter({
    url: redisUrl,
    token: redisToken,
    keySecret: rateLimitKeySecret,
  }),
  simulationRpcUrl: String(process.env.GHOSTCLAW_SIMULATION_RPC_URL ?? PUBLIC_RPC_URL).trim(),
  sponsorToken,
});
server.listen(port, "0.0.0.0", () => {
  process.stdout.write(`GhostClaw relay is ready on port ${port}.\n`);
});
