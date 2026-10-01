#!/usr/bin/env node

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  AUTHORIZED_SENDER_LIMIT,
  SharedRelayRateLimiter,
} from "./lib/relay-rate-limiter.mjs";
import { rateLimitEnvironment } from "./lib/vercel-relay.mjs";

process.umask(0o077);

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`--${name} requires a value.`);
  return value;
}

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

const environment = rateLimitEnvironment();
const keySecret = process.env.GHOSTCLAW_RATE_LIMIT_KEY_SECRET?.trim();
if (!keySecret) throw new Error("GHOSTCLAW_RATE_LIMIT_KEY_SECRET is required.");

const namespace = `ghostclaw-test-${randomBytes(8).toString("hex")}`;
const options = {
  url: environment.url,
  token: environment.token,
  keySecret,
  namespace,
};
const first = new SharedRelayRateLimiter(options);
const second = new SharedRelayRateLimiter(options);
const attempts = Array.from({ length: AUTHORIZED_SENDER_LIMIT + 1 }, (_, index) => (
  (index & 1 ? first : second).allow({
    route: "/rpc",
    method: "wallet_prepareCalls",
    ip: "redis-concurrency-test",
    sender: "redis-concurrency-test-sender",
    cost: 1,
  })
));
const results = await Promise.all(attempts);
assert.equal(results.filter(Boolean).length, AUTHORIZED_SENDER_LIMIT);
assert.equal(results.filter((value) => !value).length, 1);

let failedClosed = false;
try {
  await new SharedRelayRateLimiter({
    ...options,
    token: `${environment.token}-invalid`,
    namespace: `${namespace}-failure`,
  }).preflight({ route: "/rpc", ip: "redis-failure-test" });
} catch {
  failedClosed = true;
}
assert.equal(failedClosed, true);

const evidence = {
  status: "verified",
  concurrentInstances: 2,
  concurrentAttempts: AUTHORIZED_SENDER_LIMIT + 1,
  accepted: AUTHORIZED_SENDER_LIMIT,
  rejected: 1,
  invalidCredentialFailedClosed: true,
  testedAt: new Date().toISOString(),
};
const outputPath = argument("out");
if (outputPath) await atomicJson(resolve(outputPath), evidence);
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
