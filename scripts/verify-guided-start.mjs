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
if (!process.argv.includes("--confirm-testnet")) {
  throw new Error("Use --confirm-testnet to run sponsored Base Sepolia writes.");
}

const home = await mkdtemp(join(tmpdir(), "ghostclaw-guided-start-"));
const stateKey = randomBytes(32);
const environment = {
  ...process.env,
  GHOSTCLAW_HOME: home,
  GHOSTCLAW_STATE_KEY: stateKey.toString("hex"),
};

async function run(args, timeout = 240_000) {
  try {
    const result = await execFileAsync(
      process.execPath,
      [resolve(project, "scripts", "ghostclaw.mjs"), ...args],
      { cwd: project, env: environment, timeout, maxBuffer: 8 * 1024 * 1024 },
    );
    return JSON.parse(result.stdout);
  } catch (error) {
    const lines = String(error?.stderr ?? "").trim().split("\n").filter(Boolean);
    let diagnostic = "The child command returned no safe diagnostic.";
    for (const line of lines.reverse()) {
      try {
        const parsed = JSON.parse(line);
        if (typeof parsed?.error === "string") {
          diagnostic = `${parsed.error}${typeof parsed.code === "string" ? ` (${parsed.code})` : ""}`;
          break;
        }
      } catch {
        // The acceptance log includes only structured GhostClaw errors.
      }
    }
    throw new Error(`The guided acceptance command failed: ghostclaw ${args[0]}. ${diagnostic}`);
  }
}

try {
  const first = await run(["start", "--yes", "--connect", "none", "--quiet"]);
  assert.equal(first.status, "ready");
  assert.equal(first.network, "base-sepolia");
  assert.equal(first.localWallet, "created");
  assert.equal(first.registration?.state, "created");
  assert.equal(first.testFunds?.status, "deposited");
  assert.equal(first.testFunds?.amount, "100");
  assert.match(first.testFunds?.claimTransaction ?? "", /^0x[0-9a-f]{64}$/i);
  assert.match(first.testFunds?.depositTransaction ?? "", /^0x[0-9a-f]{64}$/i);

  const second = await run(["start", "--yes", "--connect", "none", "--quiet"]);
  assert.equal(second.status, "ready");
  assert.equal(second.account, first.account);
  assert.equal(second.localWallet, "existing");
  assert.equal(second.registration?.state, "existing");
  assert.deepEqual(second.testFunds, {
    status: "existing",
    location: "private-pool",
    sponsored: true,
  });

  const status = await run(["status"]);
  assert.equal(status.account, first.account);
  assert.equal(status.availableNotes, 1);
  assert.equal("privateBalance" in status, false);

  process.stdout.write(`${JSON.stringify({
    status: "ready",
    network: first.network,
    account: first.account,
    registrationTransaction: first.registration.transactionHash,
    claimTransaction: first.testFunds.claimTransaction,
    depositTransaction: first.testFunds.depositTransaction,
    resumedWithoutFunding: second.testFunds.status === "existing",
  }, null, 2)}\n`);
} finally {
  environment.GHOSTCLAW_STATE_KEY = "";
  stateKey.fill(0);
  await rm(home, { recursive: true, force: true });
}
