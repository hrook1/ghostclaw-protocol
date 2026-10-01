import assert from "node:assert/strict";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  createPublicClient,
  getAddress,
  http,
  keccak256,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { baseSepolia } from "viem/chains";
import { installSecretRedactingFatalHandlers } from "./lib/redact-fatal-error";

installSecretRedactingFatalHandlers();
process.umask(0o077);

const poolAbi = parseAbi([
  "function token() view returns (address)",
  "function identityVerifier() view returns (address)",
  "function depositVerifier() view returns (address)",
  "function spendVerifier() view returns (address)",
  "function withdrawVerifier() view returns (address)",
  "function poseidon2() view returns (address)",
  "function roots(uint256) view returns (bool)",
  "function currentRoot() view returns (uint256)",
  "function nullifiers(uint256) view returns (bool)",
  "function settledPaymentIntents(uint256) view returns (bool)",
  "function totalEscrowed() view returns (uint256)",
]);
const tokenAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const verifierAbi = parseAbi(["function Verify(bytes,uint256[]) view returns (bool)"]);

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function atomicJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
const deployment = JSON.parse(
  await readFile(resolve(projectRoot, "deployments/base-sepolia-v2.json"), "utf8"),
) as {
  version: number;
  chainId: number;
  contracts: Record<string, Address>;
  entries: Array<{
    name: string;
    address: Address;
    runtimeCodeHash: Hex;
    runtimeBytes: number;
    transactionHash: Hex | null;
  }>;
};
const benchmark = JSON.parse(
  await readFile(resolve(projectRoot, "benchmark-results/base-sepolia-v2-e2e.json"), "utf8"),
) as {
  version: number;
  contracts: Record<string, Address>;
  actions: Record<string, { transactionHash: Hex }>;
};
const proofs = JSON.parse(
  await readFile(resolve(projectRoot, "deployments/base-sepolia-v2-proofs.json"), "utf8"),
) as {
  identities: { payer: { proof: { proof: Hex; publicInputs: string[] } } };
  payment: {
    spendRoot: string;
    nullifier: string;
    paymentIntent: string;
    proof: { proof: Hex; publicInputs: string[] };
  };
  withdraw: {
    spendRoot: string;
    nullifier: string;
    proof: { proof: Hex; publicInputs: string[] };
  };
};
assert.equal(deployment.version, 2);
assert.equal(benchmark.version, 2);
assert.equal(deployment.chainId, 84532);
assert.deepEqual(benchmark.contracts, deployment.contracts);

const clients = {
  alchemy: createPublicClient({
    chain: baseSepolia,
    transport: http(required("ALCHEMY_BASE_SEPOLIA_RPC_URL"), { retryCount: 0, timeout: 60_000 }),
  }),
  independent: createPublicClient({
    chain: baseSepolia,
    transport: http(required("BASE_SEPOLIA_SECONDARY_RPC_URL"), { retryCount: 0, timeout: 60_000 }),
  }),
};
// Viem exposes an authorization-list generic that is incompatible with its
// own read-only client type. Runtime address, code, receipt, and value checks
// remain mandatory for every value returned through this client.
const independent: any = clients.independent;
assert.equal(await clients.alchemy.getChainId(), 84532);
assert.equal(await clients.independent.getChainId(), 84532);

const codeChecks: Record<string, unknown> = {};
for (const entry of deployment.entries) {
  const [primary, secondary] = await Promise.all([
    clients.alchemy.getBytecode({ address: entry.address }),
    clients.independent.getBytecode({ address: entry.address }),
  ]);
  assert.ok(primary && primary !== "0x");
  assert.equal(primary, secondary);
  assert.equal(keccak256(primary), entry.runtimeCodeHash);
  assert.equal((primary.length - 2) / 2, entry.runtimeBytes);
  assert.ok(entry.runtimeBytes < 24_576);
  codeChecks[entry.name] = {
    address: getAddress(entry.address),
    runtimeBytes: entry.runtimeBytes,
    runtimeCodeHash: entry.runtimeCodeHash,
    independentRpcMatch: true,
  };
}

const pool = deployment.contracts.pool;
const wiringNames = [
  "token",
  "identityVerifier",
  "depositVerifier",
  "spendVerifier",
  "withdrawVerifier",
  "poseidon2",
] as const;
const wiringValues = await Promise.all(wiringNames.map((functionName) => (
  independent.readContract({ address: pool, abi: poolAbi, functionName })
)));
const wiring = Object.fromEntries(wiringNames.map((name, index) => [name, wiringValues[index]]));
assert.equal(getAddress(wiring.token as Address), getAddress(deployment.contracts.gUSD));
for (const name of wiringNames.slice(1)) {
  assert.equal(getAddress(wiring[name] as Address), getAddress(deployment.contracts[name]));
}

const [identityValid, paymentValid, withdrawalValid] = await Promise.all([
  independent.readContract({
    address: deployment.contracts.identityVerifier,
    abi: verifierAbi,
    functionName: "Verify",
    args: [proofs.identities.payer.proof.proof, proofs.identities.payer.proof.publicInputs.map(BigInt)],
  }),
  independent.readContract({
    address: deployment.contracts.spendVerifier,
    abi: verifierAbi,
    functionName: "Verify",
    args: [proofs.payment.proof.proof, proofs.payment.proof.publicInputs.map(BigInt)],
  }),
  independent.readContract({
    address: deployment.contracts.withdrawVerifier,
    abi: verifierAbi,
    functionName: "Verify",
    args: [proofs.withdraw.proof.proof, proofs.withdraw.proof.publicInputs.map(BigInt)],
  }),
]);
const tamperedWithdrawalInputs = proofs.withdraw.proof.publicInputs.map(BigInt);
tamperedWithdrawalInputs[5] += 1n;
const tamperedWithdrawal = await independent.readContract({
  address: deployment.contracts.withdrawVerifier,
  abi: verifierAbi,
  functionName: "Verify",
  args: [proofs.withdraw.proof.proof, tamperedWithdrawalInputs],
});
assert.equal(identityValid, true);
assert.equal(paymentValid, true);
assert.equal(withdrawalValid, true);
assert.equal(tamperedWithdrawal, false);

for (const action of Object.values(benchmark.actions)) {
  const receipt = await independent.getTransactionReceipt({ hash: action.transactionHash });
  assert.equal(receipt.status, "success");
}

const [depositRoot, paymentRoot, depositNullifier, withdrawalNullifier, paymentIntent, currentRoot, escrow, tokenBalance] =
  await Promise.all([
    independent.readContract({
      address: pool,
      abi: poolAbi,
      functionName: "roots",
      args: [BigInt(proofs.payment.spendRoot)],
    }),
    independent.readContract({
      address: pool,
      abi: poolAbi,
      functionName: "roots",
      args: [BigInt(proofs.withdraw.spendRoot)],
    }),
    independent.readContract({
      address: pool,
      abi: poolAbi,
      functionName: "nullifiers",
      args: [BigInt(proofs.payment.nullifier)],
    }),
    independent.readContract({
      address: pool,
      abi: poolAbi,
      functionName: "nullifiers",
      args: [BigInt(proofs.withdraw.nullifier)],
    }),
    independent.readContract({
      address: pool,
      abi: poolAbi,
      functionName: "settledPaymentIntents",
      args: [BigInt(proofs.payment.paymentIntent)],
    }),
    independent.readContract({ address: pool, abi: poolAbi, functionName: "currentRoot" }),
    independent.readContract({ address: pool, abi: poolAbi, functionName: "totalEscrowed" }),
    independent.readContract({
      address: deployment.contracts.gUSD,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [pool],
    }),
  ]);
assert.equal(depositRoot, true);
assert.equal(paymentRoot, true);
assert.equal(depositNullifier, true);
assert.equal(withdrawalNullifier, true);
assert.equal(paymentIntent, true);
assert.equal(escrow, tokenBalance);

const evidence = {
  version: 2,
  verifiedAt: new Date().toISOString(),
  chainId: 84532,
  independentRpc: true,
  codeChecks,
  wiring,
  proofChecks: {
    identityAccepted: identityValid,
    paymentAccepted: paymentValid,
    withdrawalAccepted: withdrawalValid,
    changedWithdrawalAuthorizationRejected: !tamperedWithdrawal,
  },
  stateChecks: {
    depositRoot,
    paymentRoot,
    depositNullifier,
    withdrawalNullifier,
    paymentIntent,
    currentRoot: currentRoot.toString(),
    escrow: escrow.toString(),
    tokenBalance: tokenBalance.toString(),
  },
  successfulTransactions: Object.values(benchmark.actions).map((action) => action.transactionHash),
};
await atomicJson(resolve(projectRoot, "deployments/base-sepolia-v2-verified.json"), evidence);
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
