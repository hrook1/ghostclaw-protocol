#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  DEFAULT_RELAY_URL,
  SponsoredTransactionAdapter,
  publicClient,
  trustedDelegationDesignation,
} from "./lib/alchemy-adapter.mjs";
import { CONTRACTS } from "./lib/protocol.mjs";

process.umask(0o077);

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

const relayUrl = process.env.GHOSTCLAW_RELAY_URL?.trim() || DEFAULT_RELAY_URL;
const account = privateKeyToAccount(generatePrivateKey());
const adapter = new SponsoredTransactionAdapter(relayUrl, account);
const writes = [];

const firstDelegation = await adapter.approve(1n);
writes.push({ action: "delegate", transactionHash: firstDelegation.transactionHash });
assert.equal(
  (await publicClient.getBytecode({ address: account.address }))?.toLowerCase(),
  trustedDelegationDesignation(),
);

const firstExit = await adapter.emergencyUndelegate();
writes.push({ action: "undelegate", transactionHash: firstExit.transactionHash });
const firstExitCode = await publicClient.getBytecode({ address: account.address });
assert.ok(!firstExitCode || firstExitCode === "0x");

const secondDelegation = await adapter.send(
  CONTRACTS.token,
  "approve(address,uint256)",
  [CONTRACTS.pool, 1n],
);
writes.push({ action: "redelegate", transactionHash: secondDelegation.transactionHash });
assert.equal(
  (await publicClient.getBytecode({ address: account.address }))?.toLowerCase(),
  trustedDelegationDesignation(),
);

const finalExit = await adapter.emergencyUndelegate();
writes.push({ action: "final-undelegate", transactionHash: finalExit.transactionHash });
const finalExitCode = await publicClient.getBytecode({ address: account.address });
assert.ok(!finalExitCode || finalExitCode === "0x");

const evidence = {
  version: 2,
  status: "verified",
  checkedAt: new Date().toISOString(),
  chainId: 84532,
  account: account.address,
  finalDelegation: "none",
  writes,
};
await atomicJson(resolve("deployments/base-sepolia-v2-undelegation.json"), evidence);
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
