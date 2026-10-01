import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTHORIZED_SENDER_LIMIT,
  MemoryRelayRateLimiter,
  SharedRelayRateLimiter,
} from "./lib/relay-rate-limiter.mjs";

const SENDER_A = "0x1111111111111111111111111111111111111111";
const SENDER_B = "0x2222222222222222222222222222222222222222";

test("rejected sender traffic does not consume another sender's global allocation", () => {
  const limiter = new MemoryRelayRateLimiter(() => 1_000);
  const request = {
    route: "/rpc",
    method: "wallet_sendPreparedCalls",
    ip: "192.0.2.1",
    sender: SENDER_A,
    cost: 1,
  };
  for (let index = 0; index < AUTHORIZED_SENDER_LIMIT; index += 1) {
    assert.equal(limiter.allow(request), true);
  }
  assert.equal(limiter.allow(request), false);
  assert.equal(limiter.allow({ ...request, ip: "192.0.2.2", sender: SENDER_B }), true);
});

test("the shared limiter sends one atomic multi-bucket Redis operation", async () => {
  let command;
  let endpoint;
  const limiter = new SharedRelayRateLimiter({
    url: "https://redis.example.invalid",
    token: "test-token",
    keySecret: "test-rate-limit-key-secret-32-bytes-long",
    fetchImpl: async (url, options) => {
      endpoint = url;
      command = JSON.parse(options.body);
      return new Response(JSON.stringify({ result: [1, 0, 0] }));
    },
  });
  assert.equal(await limiter.allow({
    route: "/rpc",
    method: "wallet_prepareCalls",
    ip: "192.0.2.3",
    sender: SENDER_A,
    cost: 10,
  }), true);
  assert.equal(endpoint, "https://redis.example.invalid");
  assert.equal(command[0], "EVAL");
  assert.equal(command[2], 4);
  assert.match(command[1], /current \+ cost > limit/);
  const serialized = JSON.stringify(command);
  assert.doesNotMatch(serialized, /192\.0\.2\.3/);
  assert.doesNotMatch(serialized, new RegExp(SENDER_A.slice(2), "i"));
});

test("a test namespace cannot consume the production rate-limit buckets", async () => {
  let command;
  const limiter = new SharedRelayRateLimiter({
    url: "https://redis.example.test",
    token: "redis-secret",
    keySecret: "0123456789abcdef0123456789abcdef",
    namespace: "ghostclaw-test-123",
    fetchImpl: async (_url, options) => {
      command = JSON.parse(options.body);
      return { ok: true, json: async () => ({ result: [1, 0, 0] }) };
    },
  });
  assert.equal(await limiter.preflight({ route: "/rpc", ip: "198.51.100.9" }), true);
  assert.match(command[3], /^ghostclaw-test-123:/);
});

test("the shared limiter rejects an unsafe namespace", () => {
  assert.throws(() => new SharedRelayRateLimiter({
    url: "https://redis.example.test",
    token: "redis-secret",
    keySecret: "0123456789abcdef0123456789abcdef",
    namespace: "ghostclaw:test",
  }));
});

test("the shared limiter checks Redis without consuming a rate-limit bucket", async () => {
  let command;
  const limiter = new SharedRelayRateLimiter({
    url: "https://redis.example.test",
    token: "redis-secret",
    keySecret: "0123456789abcdef0123456789abcdef",
    fetchImpl: async (_url, options) => {
      command = JSON.parse(options.body);
      return { ok: true, json: async () => ({ result: "PONG" }) };
    },
  });
  assert.equal(await limiter.health(), true);
  assert.deepEqual(command, ["PING"]);
});

test("the shared limiter rejects an invalid Redis health response", async () => {
  const limiter = new SharedRelayRateLimiter({
    url: "https://redis.example.test",
    token: "redis-secret",
    keySecret: "0123456789abcdef0123456789abcdef",
    fetchImpl: async () => ({ ok: true, json: async () => ({ result: null }) }),
  });
  await assert.rejects(() => limiter.health(), /invalid health response/);
});
