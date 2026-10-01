import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  createPublicClient,
  getAddress,
  http,
  keccak256,
  type Address,
} from "viem";
import { baseSepolia } from "viem/chains";
import {
  UNIVERSAL_CREATE2_DEPLOYER,
  UNIVERSAL_CREATE2_RUNTIME,
  buildDeploymentPlan,
} from "./deployment-plan";
import { loadEncryptedKeystoreOwner } from "./lib/alchemy-deployment";
import { installSecretRedactingFatalHandlers } from "./lib/redact-fatal-error";

installSecretRedactingFatalHandlers();
process.umask(0o077);

const EXPECTED_CONTRACTS = {
  gUSD: "0x67A288E50AD08FCa1d8dC4f65d80640a39e48760",
  identityVerifier: "0x886c99F83E741337c947586C423117E7F26a728a",
  depositVerifier: "0x70C8e535b3A0f25E0e7127F25097AaF83F8832b2",
  spendVerifier: "0xBb12FB3bBdcf0e77f63b0c5a52A1C62Cd51DcbdC",
  withdrawVerifier: "0xd0ba5592E6b9443b7cdD2a71c2287eB283f59b8c",
  poseidon2: "0xB2bFD7988D6b7695a54aC4864C4106242a4da21b",
  pool: "0x415330497f132e8D811b80c3EB96eb15B985f3C6",
} as const;
const SETUP_MANIFEST_SHA256 =
  "a69b232f8b887b323908b0dc5f29baa474b1b230bb773c58fd53ef554f125803";
const IGNITION_SHA256 =
  "3718ffbed583d8a279ccb2545196d5618e3fd97512b65aa051d2ebd0f57fb999";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function secureHttps(name: string) {
  const value = required(name);
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error(`${name} must contain a credential-free HTTPS URL.`);
  }
  return value;
}

async function sha256(path: string) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function atomicJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
const primaryRpc = secureHttps("ALCHEMY_BASE_SEPOLIA_RPC_URL");
const secondaryRpc = secureHttps("BASE_SEPOLIA_SECONDARY_RPC_URL");
if (primaryRpc === secondaryRpc) {
  throw new Error("The independent Base Sepolia endpoint must differ from the Alchemy endpoint.");
}
for (const name of [
  "ALCHEMY_DEPLOYMENT_GAS_POLICY_ID",
  "ALCHEMY_GAS_POLICY_ID",
  "ALCHEMY_AGENT_GAS_POLICY_ID",
  "ALCHEMY_FACILITATOR_GAS_POLICY_ID",
]) {
  required(name);
}

const owner = await loadEncryptedKeystoreOwner({
  keystorePath: required("GHOSTCLAW_DEPLOYER_KEYSTORE"),
  passwordFile: required("GHOSTCLAW_DEPLOYER_PASSWORD_FILE"),
});
const expectedOwner = getAddress(required("GHOSTCLAW_DEPLOYER_ADDRESS"));
assert.equal(getAddress(owner.address), expectedOwner);

const plan = await buildDeploymentPlan(owner.address);
assert.equal(plan.chainId, 84532);
assert.deepEqual(plan.contracts, EXPECTED_CONTRACTS);
assert.equal(new Set(plan.components.map((component) => component.address)).size, plan.components.length);

const clients = {
  alchemy: createPublicClient({
    chain: baseSepolia,
    transport: http(primaryRpc, { retryCount: 0, timeout: 60_000 }),
  }),
  independent: createPublicClient({
    chain: baseSepolia,
    transport: http(secondaryRpc, { retryCount: 0, timeout: 60_000 }),
  }),
};
const [primaryChain, secondaryChain, primaryBlock, secondaryBlock] = await Promise.all([
  clients.alchemy.getChainId(),
  clients.independent.getChainId(),
  clients.alchemy.getBlockNumber(),
  clients.independent.getBlockNumber(),
]);
assert.equal(primaryChain, 84532);
assert.equal(secondaryChain, 84532);
const blockDifference = primaryBlock > secondaryBlock
  ? primaryBlock - secondaryBlock
  : secondaryBlock - primaryBlock;
if (blockDifference > 100n) {
  throw new Error("The independent Base Sepolia endpoint is too far behind the primary endpoint.");
}

const [primaryCreate2, secondaryCreate2] = await Promise.all([
  clients.alchemy.getBytecode({ address: UNIVERSAL_CREATE2_DEPLOYER }),
  clients.independent.getBytecode({ address: UNIVERSAL_CREATE2_DEPLOYER }),
]);
assert.ok(primaryCreate2 && secondaryCreate2);
assert.equal(primaryCreate2, secondaryCreate2);
assert.equal(keccak256(primaryCreate2), keccak256(UNIVERSAL_CREATE2_RUNTIME));

const targets: Record<string, unknown> = {};
let allTargetsDeployed = true;
for (const component of plan.components) {
  const [primary, secondary] = await Promise.all([
    clients.alchemy.getBytecode({ address: component.address }),
    clients.independent.getBytecode({ address: component.address }),
  ]);
  assert.equal(primary ?? "0x", secondary ?? "0x");
  const deployed = Boolean(primary && primary !== "0x");
  allTargetsDeployed &&= deployed;
  if (deployed) {
    assert.equal((primary!.length - 2) / 2, component.expectedRuntimeBytes);
    assert.equal(keccak256(primary!), component.expectedRuntimeHash);
  }
  targets[component.name] = {
    address: component.address,
    state: deployed ? "exact-runtime-present" : "empty",
    expectedRuntimeBytes: component.expectedRuntimeBytes,
    expectedRuntimeHash: component.expectedRuntimeHash,
    artifactSha256: component.artifactSha256,
  };
}

assert.equal(await sha256(resolve(projectRoot, "artifacts/manifest.json")), SETUP_MANIFEST_SHA256);
assert.equal(await sha256(resolve(projectRoot, "public-parameters/bn254_g1.dat")), IGNITION_SHA256);

const evidence = {
  version: 2,
  checkedAt: new Date().toISOString(),
  status: allTargetsDeployed
    ? "verified-existing-base-sepolia-deployment"
    : "ready-for-fresh-base-sepolia-deployment",
  chainId: 84532,
  operator: expectedOwner,
  primaryBlock: primaryBlock.toString(),
  independentBlock: secondaryBlock.toString(),
  independentRpcMatched: true,
  canonicalCreate2DeployerMatched: true,
  setupManifestSha256: SETUP_MANIFEST_SHA256,
  ignitionSha256: IGNITION_SHA256,
  targetContracts: targets,
  policyEnvironmentConfigured: {
    deployment: true,
    publicRelay: true,
    agent: true,
    facilitator: true,
  },
};
await atomicJson(resolve(projectRoot, "deployments/base-sepolia-v2-preflight.json"), evidence);
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
