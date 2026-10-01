import assert from "node:assert/strict";
import test from "node:test";
import { handleVercelRelay, rateLimitEnvironment } from "./lib/vercel-relay.mjs";

test("the relay accepts the Vercel Upstash variable names", () => {
  assert.deepEqual(rateLimitEnvironment({
    KV_REST_API_URL: "https://example.upstash.io",
    KV_REST_API_TOKEN: "token",
  }), {
    url: "https://example.upstash.io",
    token: "token",
  });
});

test("the relay accepts the connected GhostClaw Upstash prefix", () => {
  assert.deepEqual(rateLimitEnvironment({
    UPSTASH_REDIS_REST_KV_REST_API_URL: "https://prefixed.example.upstash.io",
    UPSTASH_REDIS_REST_KV_REST_API_TOKEN: "prefixed-token",
  }), {
    url: "https://prefixed.example.upstash.io",
    token: "prefixed-token",
  });
});

test("the GhostClaw Redis names take precedence", () => {
  assert.deepEqual(rateLimitEnvironment({
    GHOSTCLAW_RATE_LIMIT_REDIS_URL: "https://ghostclaw.example",
    GHOSTCLAW_RATE_LIMIT_REDIS_TOKEN: "ghostclaw-token",
    KV_REST_API_URL: "https://upstash.example",
    KV_REST_API_TOKEN: "upstash-token",
  }), {
    url: "https://ghostclaw.example",
    token: "ghostclaw-token",
  });
});

test("the relay fails closed without both Redis values", () => {
  assert.throws(
    () => rateLimitEnvironment({ KV_REST_API_URL: "https://example.upstash.io" }),
    /token is required/,
  );
});

test("a missing hosted dependency returns a structured unavailable response", () => {
  const saved = Object.fromEntries([
    "ALCHEMY_API_KEY",
    "ALCHEMY_AGENT_GAS_POLICY_ID",
    "ALCHEMY_UNDELEGATION_GAS_POLICY_ID",
    "GHOSTCLAW_RATE_LIMIT_KEY_SECRET",
    "GHOSTCLAW_RATE_LIMIT_REDIS_TOKEN",
    "GHOSTCLAW_RATE_LIMIT_REDIS_URL",
    "GHOSTCLAW_SPONSOR_CALLBACK_TOKEN",
    "KV_REST_API_TOKEN",
    "KV_REST_API_URL",
    "UPSTASH_REDIS_REST_TOKEN",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_KV_REST_API_TOKEN",
    "UPSTASH_REDIS_REST_KV_REST_API_URL",
  ].map((name) => [name, process.env[name]]));
  for (const name of Object.keys(saved)) delete process.env[name];
  let status;
  let headers;
  let body;
  try {
    handleVercelRelay({}, {
      writeHead(value, values) {
        status = value;
        headers = values;
      },
      end(value) {
        body = value;
      },
    }, "/health");
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
  assert.equal(status, 503);
  assert.equal(headers["cache-control"], "no-store");
  assert.deepEqual(JSON.parse(body), { error: "relay_unavailable" });
});
