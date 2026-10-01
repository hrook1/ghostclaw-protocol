#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import {
  createPublicClient,
  getAddress,
  http,
  keccak256,
  parseAbi,
  size,
} from "viem";
import { baseSepolia } from "viem/chains";
import {
  DEFAULT_RELAY_URL,
  TRUSTED_DELEGATION_ADDRESS,
  TRUSTED_DELEGATION_RUNTIME_BYTES,
  TRUSTED_DELEGATION_RUNTIME_HASH,
} from "./lib/alchemy-adapter.mjs";
import {
  CHAIN_ID,
  CONTRACTS,
  PUBLIC_RPC_URL,
} from "./lib/protocol.mjs";
import { PINNED_ARTIFACTS } from "./lib/artifact-manifest.mjs";

const poolConfigurationAbi = parseAbi([
  "function context() view returns (uint256)",
  "function token() view returns (address)",
  "function identityVerifier() view returns (address)",
  "function depositVerifier() view returns (address)",
  "function spendVerifier() view returns (address)",
  "function withdrawVerifier() view returns (address)",
  "function poseidon2() view returns (address)",
  "function nextLeafIndex() view returns (uint256)",
  "function currentRoot() view returns (uint256)",
]);

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`--${name} requires a value.`);
  return value;
}

function baseUrl() {
  const configured = argument("relay")
    ?? process.env.GHOSTCLAW_RELAY_URL
    ?? DEFAULT_RELAY_URL;
  const value = new URL(configured);
  if (value.protocol !== "https:") throw new Error("The live relay must use HTTPS.");
  value.pathname = "/";
  value.search = "";
  value.hash = "";
  return value;
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      accept: "application/json",
      ...options.headers,
    },
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

const relay = baseUrl();
const healthUrl = new URL("health", relay);
const rpcUrl = new URL("rpc", relay);
const facilitatorUrl = new URL("facilitator/verify", relay);
const demoStatusUrl = new URL("demo/address-report?status=1", relay);
const noteTreeUrl = new URL("note-tree", relay);
const artifactUrl = new URL("proving/1.5.0/ghostclaw-v2-manifest.json", relay);
const demoDeployment = JSON.parse(await readFile(
  new URL("../deployments/base-sepolia-demo-merchant.json", import.meta.url),
  "utf8",
));
const health = await jsonRequest(healthUrl, { cache: "no-store" });
if (!health.response.ok || health.payload?.status !== "ready") {
  throw new Error("The hosted relay health check failed.");
}

const facilitator = await jsonRequest(facilitatorUrl, {
  cache: "no-store",
  redirect: "manual",
});
if (facilitator.response.status !== 404 || facilitator.payload?.error !== "not_found") {
  throw new Error("The hosted facilitator route is unavailable.");
}

const demo = await jsonRequest(demoStatusUrl, {
  cache: "no-store",
  redirect: "manual",
});
if (
  !demo.response.ok
  || demo.payload?.status !== "ready"
  || demo.payload?.network !== "base-sepolia"
  || getAddress(demo.payload?.merchant) !== getAddress(demoDeployment.merchant)
  || demo.payload?.price !== "1"
) {
  throw new Error("The hosted paid address-report route is unavailable.");
}

const noteTree = await jsonRequest(noteTreeUrl, { cache: "no-store", redirect: "manual" });
if (
  !noteTree.response.ok
  || noteTree.payload?.version !== 1
  || noteTree.payload?.network !== "base-sepolia"
  || getAddress(noteTree.payload?.pool) !== CONTRACTS.pool
  || !/^[0-9]+$/.test(String(noteTree.payload?.toBlock ?? ""))
  || !Array.isArray(noteTree.payload?.logs)
) {
  throw new Error("The hosted public note snapshot is unavailable.");
}
for (let index = 0; index < noteTree.payload.logs.length; index += 1) {
  const log = noteTree.payload.logs[index];
  if (
    log.pairIndex !== String(index)
    || ![log.blockNumber, log.logIndex, log.left, log.right, log.root]
      .every((value) => /^(0|[1-9][0-9]*)$/.test(String(value ?? "")))
  ) {
    throw new Error("The hosted public note snapshot contains an invalid event.");
  }
}

const artifact = await fetch(artifactUrl, {
  cache: "no-store",
  redirect: "manual",
  signal: AbortSignal.timeout(15_000),
});
const artifactBytes = Buffer.from(await artifact.arrayBuffer());
const expectedArtifact = PINNED_ARTIFACTS.find((item) => item.download === "ghostclaw-v2-manifest.json");
if (
  !artifact.ok
  || !expectedArtifact
  || artifactBytes.length !== expectedArtifact.size
  || createHash("sha256").update(artifactBytes).digest("hex") !== expectedArtifact.sha256
) {
  artifactBytes.fill(0);
  throw new Error("The hosted proving-file manifest does not match the package pin.");
}
artifactBytes.fill(0);

const rejected = await jsonRequest(rpcUrl, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
});
if (
  !rejected.response.ok
  || rejected.payload?.error?.code !== -32602
  || !/rejected|not permitted|supported|outside/i.test(String(rejected.payload?.error?.message ?? ""))
) {
  throw new Error("The public relay accepted an unsupported JSON-RPC method.");
}

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(
    argument("rpc")
      ?? process.env.GHOSTCLAW_SIMULATION_RPC_URL
      ?? process.env.ALCHEMY_BASE_SEPOLIA_RPC_URL
      ?? PUBLIC_RPC_URL,
    {
      retryCount: 1,
      timeout: 30_000,
    },
  ),
});
if (await client.getChainId() !== CHAIN_ID) throw new Error("The verification RPC is not Base Sepolia.");

const codeTargets = {
  pool: CONTRACTS.pool,
  token: CONTRACTS.token,
  identityVerifier: CONTRACTS.identityVerifier,
  depositVerifier: CONTRACTS.depositVerifier,
  spendVerifier: CONTRACTS.spendVerifier,
  withdrawalVerifier: CONTRACTS.withdrawalVerifier,
  poseidon2: CONTRACTS.poseidon2,
  delegation: TRUSTED_DELEGATION_ADDRESS,
};
const code = {};
for (const [name, address] of Object.entries(codeTargets)) {
  const runtime = await client.getBytecode({ address });
  if (!runtime || runtime === "0x") throw new Error(`${name} has no Base Sepolia runtime.`);
  code[name] = {
    address,
    bytes: size(runtime),
    hash: keccak256(runtime),
  };
}
if (
  code.delegation.bytes !== TRUSTED_DELEGATION_RUNTIME_BYTES
  || code.delegation.hash !== TRUSTED_DELEGATION_RUNTIME_HASH
) {
  throw new Error("The Alchemy delegation runtime does not match the pinned release.");
}

const [context, token, identityVerifier, depositVerifier, spendVerifier, withdrawalVerifier, poseidon2] = await Promise.all([
  client.readContract({ address: CONTRACTS.pool, abi: poolConfigurationAbi, functionName: "context" }),
  client.readContract({ address: CONTRACTS.pool, abi: poolConfigurationAbi, functionName: "token" }),
  client.readContract({ address: CONTRACTS.pool, abi: poolConfigurationAbi, functionName: "identityVerifier" }),
  client.readContract({ address: CONTRACTS.pool, abi: poolConfigurationAbi, functionName: "depositVerifier" }),
  client.readContract({ address: CONTRACTS.pool, abi: poolConfigurationAbi, functionName: "spendVerifier" }),
  client.readContract({ address: CONTRACTS.pool, abi: poolConfigurationAbi, functionName: "withdrawVerifier" }),
  client.readContract({ address: CONTRACTS.pool, abi: poolConfigurationAbi, functionName: "poseidon2" }),
]);
if (context !== BigInt(CONTRACTS.pool)) throw new Error("The pool context is incorrect.");
if (getAddress(token) !== CONTRACTS.token) throw new Error("The pool token is incorrect.");
if (getAddress(identityVerifier) !== CONTRACTS.identityVerifier) throw new Error("The identity verifier is incorrect.");
if (getAddress(depositVerifier) !== CONTRACTS.depositVerifier) throw new Error("The deposit verifier is incorrect.");
if (getAddress(spendVerifier) !== CONTRACTS.spendVerifier) throw new Error("The spend verifier is incorrect.");
if (getAddress(withdrawalVerifier) !== CONTRACTS.withdrawalVerifier) throw new Error("The withdrawal verifier is incorrect.");
if (getAddress(poseidon2) !== CONTRACTS.poseidon2) throw new Error("The Poseidon2 contract is incorrect.");
const snapshotBlock = BigInt(noteTree.payload.toBlock);
const [snapshotLeafCount, snapshotRoot] = await Promise.all([
  client.readContract({
    address: CONTRACTS.pool,
    abi: poolConfigurationAbi,
    functionName: "nextLeafIndex",
    blockNumber: snapshotBlock,
  }),
  client.readContract({
    address: CONTRACTS.pool,
    abi: poolConfigurationAbi,
    functionName: "currentRoot",
    blockNumber: snapshotBlock,
  }),
]);
if (snapshotLeafCount !== BigInt(noteTree.payload.logs.length * 2)) {
  throw new Error("The hosted public note snapshot has an incorrect event count.");
}
if (
  noteTree.payload.logs.length > 0
  && snapshotRoot !== BigInt(noteTree.payload.logs.at(-1).root)
) {
  throw new Error("The hosted public note snapshot has an incorrect final root.");
}

const result = {
  status: "ready",
  checkedAt: new Date().toISOString(),
  chainId: CHAIN_ID,
  relay: relay.origin,
  checks: {
    health: true,
    facilitator: true,
    paidDemo: true,
    publicNoteSnapshot: true,
    pinnedArtifact: true,
    unsupportedMethodRejected: true,
    contractsPresent: true,
    poolWiring: true,
    delegationRuntime: true,
  },
  code,
};
const output = `${JSON.stringify(result, null, 2)}\n`;
const outputPath = argument("out");
if (outputPath) await writeFile(outputPath, output, { mode: 0o600 });
process.stdout.write(output);
