import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { getAddress, keccak256, type Address, type Hex } from "viem";
import {
  UNIVERSAL_CREATE2_DEPLOYER,
  UNIVERSAL_CREATE2_RUNTIME,
  buildDeploymentPlan,
} from "./deployment-plan";
import {
  createDeploymentClients,
  loadEncryptedKeystoreOwner,
  sendDeploymentCalls,
} from "./lib/alchemy-deployment";
import { installSecretRedactingFatalHandlers } from "./lib/redact-fatal-error";

installSecretRedactingFatalHandlers();
process.umask(0o077);

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function atomicJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, path);
}

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
const owner = await loadEncryptedKeystoreOwner({
  keystorePath: required("GHOSTCLAW_DEPLOYER_KEYSTORE"),
  passwordFile: required("GHOSTCLAW_DEPLOYER_PASSWORD_FILE"),
});
const expectedOwner = process.env.GHOSTCLAW_DEPLOYER_ADDRESS?.trim();
if (expectedOwner && getAddress(expectedOwner) !== getAddress(owner.address)) {
  throw new Error("The configured deployer address does not match the encrypted keystore.");
}
const { account, bundler, publicClient } =
  await createDeploymentClients({
    rpcUrl: required("ALCHEMY_BASE_SEPOLIA_RPC_URL"),
    policyId: required("ALCHEMY_DEPLOYMENT_GAS_POLICY_ID"),
    owner,
  });
if ((await publicClient.getChainId()) !== 84532) {
  throw new Error("The configured endpoint is not Base Sepolia.");
}
const create2Code = await publicClient.getBytecode({
  address: UNIVERSAL_CREATE2_DEPLOYER,
});
if (
  !create2Code
  || keccak256(create2Code) !== keccak256(UNIVERSAL_CREATE2_RUNTIME)
) {
  throw new Error("The canonical CREATE2 deployer is unavailable.");
}

const plan = await buildDeploymentPlan(account.address);

const entries: Array<{
  name: string;
  address: Address;
  salt: Hex;
  initCodeHash: Hex;
  artifactSha256: string;
  runtimeCodeHash: Hex;
  runtimeBytes: number;
  userOperationHash: Hex | null;
  transactionHash: Hex | null;
  blockNumber: number | null;
  reused: boolean;
}> = [];
for (const component of plan.components) {
  let code = await publicClient.getBytecode({ address: component.address });
  let receipt: Awaited<ReturnType<typeof sendDeploymentCalls>> | null = null;
  if (!code || code === "0x") {
    process.stdout.write(`Deploy ${component.name} at ${component.address}.\n`);
    receipt = await sendDeploymentCalls({
      bundler,
      calls: [{
        to: UNIVERSAL_CREATE2_DEPLOYER,
        value: 0n,
        data: component.deployerCalldata,
      }],
      timeout: 300_000,
    });
    code = await publicClient.getBytecode({ address: component.address });
  } else {
    process.stdout.write(`Reuse ${component.name} at ${component.address}.\n`);
  }
  if (!code || code === "0x") {
    throw new Error(`${component.name} was not deployed.`);
  }
  const runtimeBytes = (code.length - 2) / 2;
  if (runtimeBytes !== component.expectedRuntimeBytes) {
    throw new Error(`${component.name} has an unexpected runtime size.`);
  }
  if (keccak256(code) !== component.expectedRuntimeHash) {
    throw new Error(`${component.name} has an unexpected runtime hash.`);
  }
  entries.push({
    name: component.name,
    address: component.address,
    salt: component.salt,
    initCodeHash: component.initCodeHash,
    artifactSha256: component.artifactSha256,
    runtimeCodeHash: keccak256(code),
    runtimeBytes,
    userOperationHash: receipt?.userOperationHash ?? null,
    transactionHash: receipt?.transactionHash ?? null,
    blockNumber: receipt?.blockNumber ?? null,
    reused: receipt === null,
  });
}

const setupManifest = await readFile(
  resolve(projectRoot, "artifacts/manifest.json"),
);
const evidence = {
  version: 2,
  generatedAt: new Date().toISOString(),
  chainId: 84532,
  status: "live-testnet-only",
  productionSafe: false,
  model: "depth-20-append-only-note-tree",
  proofSystem: "Consensys gnark PLONK on BN254",
  projectSpecificCeremony: false,
  universalSrs: "Aztec Ignition",
  ignitionG1Sha256:
    "3718ffbed583d8a279ccb2545196d5618e3fd97512b65aa051d2ebd0f57fb999",
  operatorOwner: getAddress(owner.address),
  operatorSmartAccount: getAddress(account.address),
  create2Deployer: UNIVERSAL_CREATE2_DEPLOYER,
  setupManifestSha256: createHash("sha256").update(setupManifest).digest("hex"),
  contracts: plan.contracts,
  reusedContracts: plan.reusedContracts,
  entries,
  limitations: [
    "Base Sepolia assets and sponsored gas have no market value.",
    "The final v2 signed tag requires independent audit before a production claim.",
    "The payment graph still reveals payer and merchant identities.",
  ],
  sponsorship: {
    provider: "Alchemy Gas Manager",
    mode: "bundler-sponsored-operations",
    changesTrustModel: false,
  },
};
await atomicJson(resolve(projectRoot, "deployments/base-sepolia-v2.json"), evidence);
process.stdout.write(`Pool ${plan.contracts.pool}\n`);
