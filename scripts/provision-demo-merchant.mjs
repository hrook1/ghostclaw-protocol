#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

process.umask(0o077);

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`--${name} requires a value.`);
  return value;
}

function output(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function parseSecretFile(text) {
  const result = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) throw new Error("The demo merchant secret file is invalid.");
    result[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return result;
}

if (!process.argv.includes("--confirm-testnet")) {
  throw new Error("Use --confirm-testnet to create and register the Base Sepolia demo merchant.");
}

const walletHome = resolve(option("wallet-home", ".ghostclaw/demo-merchant-wallet"));
const secretPath = resolve(option("secret-file", ".ghostclaw/demo-merchant-secrets.env"));
const deploymentPath = resolve(option(
  "deployment-file",
  ".operator/base-sepolia-demo-merchant.sealed.json",
));
const publicDeploymentOption = option("public-deployment-file", null);
const publicDeploymentPath = publicDeploymentOption === null ? null : resolve(publicDeploymentOption);
if (publicDeploymentPath === deploymentPath) {
  throw new Error("The public manifest and encrypted deployment need separate paths.");
}
const artifactDirectory = resolve(option(
  "artifact-dir",
  "release/artifacts/.verification",
));

try {
  await readFile(deploymentPath);
  throw new Error("The demo merchant deployment already exists. Preserve its identity.");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

if (publicDeploymentPath !== null) {
  try {
    await readFile(publicDeploymentPath);
    throw new Error("The public demo merchant deployment already exists. Preserve its reviewed identity.");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

let secrets;
try {
  secrets = parseSecretFile(await readFile(secretPath, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  secrets = {
    GHOSTCLAW_DEMO_MERCHANT_SECRET: randomBytes(32).toString("base64url"),
    GHOSTCLAW_DEMO_MERCHANT_LOCAL_STATE_KEY: randomBytes(32).toString("hex"),
  };
  await mkdir(dirname(secretPath), { recursive: true, mode: 0o700 });
  await writeFile(secretPath, [
    `GHOSTCLAW_DEMO_MERCHANT_SECRET=${secrets.GHOSTCLAW_DEMO_MERCHANT_SECRET}`,
    `GHOSTCLAW_DEMO_MERCHANT_LOCAL_STATE_KEY=${secrets.GHOSTCLAW_DEMO_MERCHANT_LOCAL_STATE_KEY}`,
    "",
  ].join("\n"), { mode: 0o600, flag: "wx" });
}

if (
  !/^[A-Za-z0-9_-]{43}$/.test(secrets.GHOSTCLAW_DEMO_MERCHANT_SECRET ?? "")
  || !/^[0-9a-f]{64}$/i.test(secrets.GHOSTCLAW_DEMO_MERCHANT_LOCAL_STATE_KEY ?? "")
) {
  throw new Error("The demo merchant secret file is invalid.");
}

process.env.GHOSTCLAW_HOME = walletHome;
process.env.GHOSTCLAW_STATE_KEY = secrets.GHOSTCLAW_DEMO_MERCHANT_LOCAL_STATE_KEY;
process.env.GHOSTCLAW_ARTIFACT_DIR = artifactDirectory;

const [{
  DEFAULT_RELAY_URL,
  SponsoredTransactionAdapter,
  readPool,
}, {
  CONTRACTS,
  NETWORK,
  randomField,
}, {
  deriveOwner,
  prove,
}, {
  createState,
  loadState,
  saveState,
  stateExists,
  transactionAccount,
}, {
  loadTransactionSigner,
}, {
  sealJson,
}, {
  validateDemoMerchantDeployment,
}, {
  publicDemoMerchantDeployment,
}] = await Promise.all([
  import("./lib/alchemy-adapter.mjs"),
  import("./lib/protocol.mjs"),
  import("./lib/prover.mjs"),
  import("./lib/state.mjs"),
  import("./lib/transaction-signer.mjs"),
  import("./lib/sealed-json.mjs"),
  import("./lib/demo-merchant-store.mjs"),
  import("./lib/demo-merchant-deployment.mjs"),
]);

let state = await stateExists() ? await loadState() : await createState(randomField());
state.owner ??= await deriveOwner(CONTRACTS.pool, state.spendKey);
await saveState(state);
const merchant = transactionAccount(state);
const existingOwner = await readPool("ownerOf", [merchant]);
let registrationTransactionHash = null;
if (existingOwner === 0n) {
  const proof = await prove("prove-identity", {
    context: CONTRACTS.pool,
    spendKey: state.spendKey,
    account: merchant,
    action: "1",
    nonce: "0",
  });
  if (String(proof.owner) !== String(state.owner)) {
    throw new Error("The demo merchant identity proof returned another owner.");
  }
  const adapter = new SponsoredTransactionAdapter(
    DEFAULT_RELAY_URL,
    await loadTransactionSigner(state),
  );
  const receipt = await adapter.registerSelf(proof);
  registrationTransactionHash = receipt.transactionHash;
} else if (existingOwner !== BigInt(state.owner)) {
  throw new Error("The demo merchant account is registered to another private owner.");
}

const confirmedOwner = await readPool("ownerOf", [merchant]);
if (confirmedOwner !== BigInt(state.owner)) {
  throw new Error("Base Sepolia did not record the demo merchant identity.");
}

const deployment = {
  version: 1,
  status: "live-testnet-only",
  network: NETWORK,
  merchant,
  owner: String(state.owner),
  noteEncryptionPublicKey: state.noteEncryptionPublicKey,
  registeredAt: new Date().toISOString(),
  registrationTransactionHash,
  sealedState: sealJson(state, secrets.GHOSTCLAW_DEMO_MERCHANT_SECRET, {
    purpose: "demo-merchant-state",
    aad: `ghostclaw-demo-merchant-state-v1:${merchant.toLowerCase()}`,
  }),
};
validateDemoMerchantDeployment(deployment, secrets.GHOSTCLAW_DEMO_MERCHANT_SECRET);
await mkdir(dirname(deploymentPath), { recursive: true, mode: 0o700 });
await writeFile(deploymentPath, `${JSON.stringify(deployment, null, 2)}\n`, {
  mode: 0o600,
  flag: "wx",
});
if (publicDeploymentPath !== null) {
  await mkdir(dirname(publicDeploymentPath), { recursive: true, mode: 0o755 });
  await writeFile(publicDeploymentPath, `${JSON.stringify(publicDemoMerchantDeployment(deployment), null, 2)}\n`, {
    mode: 0o644,
    flag: "wx",
  });
}

state = null;
secrets.GHOSTCLAW_DEMO_MERCHANT_LOCAL_STATE_KEY = "";
secrets.GHOSTCLAW_DEMO_MERCHANT_SECRET = "";

output({
  status: "provisioned",
  network: NETWORK,
  merchant: deployment.merchant,
  owner: deployment.owner,
  registrationTransactionHash,
  deploymentFile: deploymentPath,
  publicDeploymentFile: publicDeploymentPath,
  secretFile: secretPath,
});
