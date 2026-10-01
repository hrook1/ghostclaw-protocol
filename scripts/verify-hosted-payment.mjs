#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const project = resolve(import.meta.dirname, "..");

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`--${name} requires a value.`);
  return value;
}

if (!process.argv.includes("--confirm-testnet")) {
  throw new Error("Use --confirm-testnet to run sponsored Base Sepolia writes.");
}

const configured = new URL(
  argument("relay")
    ?? process.env.GHOSTCLAW_RELAY_URL
    ?? "https://ghostclaw-confidential-payments.vercel.app",
);
if (configured.protocol !== "https:" || configured.username || configured.password) {
  throw new Error("The hosted acceptance URL must use HTTPS without user information.");
}
configured.pathname = "/";
configured.search = "";
configured.hash = "";
const relayOrigin = configured.origin;
const relayUrl = new URL("rpc", configured).href;
const artifactUrl = new URL("proving/1.5.0/", configured).href;
const home = await mkdtemp(join(tmpdir(), "ghostclaw-hosted-payment-"));
const stateKey = randomBytes(32);
const environment = {
  ...process.env,
  GHOSTCLAW_HOME: home,
  GHOSTCLAW_STATE_KEY: stateKey.toString("hex"),
  GHOSTCLAW_RELAY_URL: relayUrl,
  GHOSTCLAW_NOTE_TREE_URL: new URL("note-tree", configured).href,
  GHOSTCLAW_ARTIFACT_BASE_URL: artifactUrl,
};

async function runCli(args, timeout = 180_000) {
  try {
    return await execFileAsync(
      process.execPath,
      [resolve(project, "scripts", "ghostclaw.mjs"), ...args],
      { cwd: project, env: environment, timeout, maxBuffer: 8 * 1024 * 1024 },
    );
  } catch {
    throw new Error(`The hosted acceptance command failed: ghostclaw ${args[0]}.`);
  }
}

try {
  await runCli(["init", "--connect", "none", "--relay-url", relayUrl]);
  await runCli(["claim"]);
  await runCli(["deposit", "--amount", "100"]);

  Object.assign(process.env, environment);
  const [{ fetchDetailed }, { getPublicPolicy }, state, protocol] = await Promise.all([
    import("./lib/x402-client.mjs"),
    import("./lib/agent-policy.mjs"),
    import("./lib/state.mjs"),
    import("./lib/protocol.mjs"),
  ]);
  const wallet = await state.loadState();
  const account = state.transactionAccount(wallet);
  const reportUrl = new URL("demo/address-report", configured);
  reportUrl.searchParams.set("address", account);
  const before = await getPublicPolicy();
  let result;
  let retried = false;
  let deliveryError = null;
  try {
    result = await fetchDetailed(reportUrl, {}, { timeoutMs: 90_000 });
  } catch (error) {
    if (error?.code !== "GHOSTCLAW_RESOURCE_DELIVERY_FAILED") throw error;
    retried = true;
    deliveryError = error;
    try {
      result = await fetchDetailed(reportUrl, {}, { timeoutMs: 90_000 });
    } catch (retryError) {
      deliveryError = retryError;
    }
  }
  const after = await getPublicPolicy();
  const spent = protocol.parseTokenAmount(before.remainingSession)
    - protocol.parseTokenAmount(after.remainingSession);
  assert.equal(spent, protocol.parseTokenAmount("1"), "The hosted retry spent more than one test gUSD.");
  if (!result) throw deliveryError ?? new Error("The hosted report did not return a result.");

  const body = await result.response.json();
  assert.equal(result.response.status, 200);
  assert.equal(body?.status, "ready");
  assert.equal(body?.report?.address, account);
  assert.equal(body?.report?.network, "base-sepolia");
  assert.equal(body?.transactionHash, result.payment?.transactionHash);
  const deliveryUrl = new URL(body.deliveryUrl);
  assert.equal(deliveryUrl.origin, relayOrigin);
  const delivered = await fetch(deliveryUrl, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  const deliveredBody = await delivered.json();
  assert.equal(delivered.status, 200);
  assert.equal(deliveredBody?.jobId, body.jobId);
  assert.deepEqual(deliveredBody?.report, body.report);

  process.stdout.write(`${JSON.stringify({
    status: "ready",
    network: "base-sepolia",
    relay: relayOrigin,
    account,
    paymentTransaction: result.payment.transactionHash,
    jobId: body.jobId,
    deliveryUrl: body.deliveryUrl,
    retried,
    sessionSpend: protocol.formatTokenAmount(spent),
  }, null, 2)}\n`);
} finally {
  environment.GHOSTCLAW_STATE_KEY = "";
  delete process.env.GHOSTCLAW_STATE_KEY;
  stateKey.fill(0);
  await rm(home, { recursive: true, force: true });
}
