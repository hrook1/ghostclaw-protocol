import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import {
  createPublicClient,
  encodeFunctionData,
  formatEther,
  getAddress,
  http,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import {
  DEFAULT_RELAY_URL,
  SponsoredTransactionAdapter,
} from "./lib/alchemy-adapter.mjs";
import {
  inspectReceivedPayment,
  prepareProver,
  prove,
  PROVER_GO_MEMORY_LIMIT,
  PROVER_MEMORY_LIMIT_BYTES,
} from "./lib/prover.mjs";
import {
  BN254_SCALAR_FIELD,
  bindRequestDigest,
  canonicalRequestDigest,
} from "./lib/protocol.mjs";
import { installSecretRedactingFatalHandlers } from "./lib/redact-fatal-error";
import { validatePaymentResponse } from "./lib/settlement.mjs";
import { encryptNote } from "./lib/state.mjs";
import { collectNoteTree } from "./lib/tree-sync.mjs";

installSecretRedactingFatalHandlers();
process.umask(0o077);

const execFileAsync = promisify(execFile);
const poolAbi = parseAbi([
  "function context() view returns (uint256)",
  "function ownerOf(address) view returns (uint256)",
  "function identityNonce(uint256) view returns (uint256)",
  "function pendingRecovery(uint256) view returns (address currentAccount,address newAccount,uint256 executeAfter,uint256 nonce)",
  "function accountConsentDigest(uint256,address,address,uint256,uint256,uint256) view returns (bytes32)",
  "function roots(uint256) view returns (bool)",
  "function currentRoot() view returns (uint256)",
  "function nextLeafIndex() view returns (uint256)",
  "function commitments(uint256) view returns (bool)",
  "function nullifiers(uint256) view returns (bool)",
  "function settledPaymentIntents(uint256) view returns (bool)",
  "function totalEscrowed() view returns (uint256)",
  "function registerSelf(bytes,uint256)",
  "function requestRecovery(bytes,uint256,address,uint256,bytes)",
  "function cancelRecovery(uint256)",
  "function deposit(bytes,uint256,uint64)",
  "function confidentialTransfer(bytes,uint256,uint256,uint256,uint256,uint256,uint256,address)",
  "function withdraw(bytes,uint256,uint256,uint256,address,uint64)",
]);
const tokenAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function faucetUsed(address) view returns (bool)",
  "function faucet()",
  "function approve(address,uint256) returns (bool)",
]);
const verifierAbi = parseAbi([
  "function Verify(bytes,uint256[]) view returns (bool)",
]);

type SolidityProof = {
  proof: Hex;
  publicInputs: string[];
  proveMs: number;
  verifyMs: number;
};

type ProofBundle = {
  protocol: string;
  context: string;
  payer: Address;
  merchant: Address;
  owners: { payer: string; merchant: string };
  identities: {
    payer: { proof: SolidityProof; owner: string; account: Address; actionDigest: string };
    merchant: { proof: SolidityProof; owner: string; account: Address; actionDigest: string };
  };
  deposit: {
    proof: SolidityProof;
    commitment: string;
    amount: string;
  };
  payment: {
    proof: SolidityProof;
    spendRoot: string;
    nullifier: string;
    outputLeft: string;
    outputRight: string;
    recipientCommitment: string;
    changeCommitment: string;
    recipientOwner: string;
    paymentIntent: string;
    merchant: Address;
  };
  withdraw: {
    proof: SolidityProof;
    spendRoot: string;
    nullifier: string;
    changeCommitment: string;
    recipient: Address;
    amount: string;
  };
};

type RawReceipt = {
  gasUsed: Hex;
  effectiveGasPrice: Hex;
  l1Fee?: Hex;
  status: Hex;
};

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function atomicJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, path);
}

async function ethUsdQuote() {
  const response = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot", {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("The ETH/USD price request failed.");
  const body = await response.json() as { data?: { amount?: string; currency?: string } };
  const usdPerEth = Number(body.data?.amount);
  if (!Number.isFinite(usdPerEth) || usdPerEth <= 0 || body.data?.currency !== "USD") {
    throw new Error("The ETH/USD quote is invalid.");
  }
  return {
    source: "Coinbase ETH-USD spot API",
    capturedAt: new Date().toISOString(),
    usdPerEth,
  };
}

function cost(raw: RawReceipt, usdPerEth: number) {
  const gasUsed = BigInt(raw.gasUsed);
  const effectiveGasPriceWei = BigInt(raw.effectiveGasPrice);
  const l2ExecutionFeeWei = gasUsed * effectiveGasPriceWei;
  const l1DataFeeWei = raw.l1Fee ? BigInt(raw.l1Fee) : 0n;
  const totalFeeWei = l2ExecutionFeeWei + l1DataFeeWei;
  const totalFeeEth = formatEther(totalFeeWei);
  return {
    gasUsed: gasUsed.toString(),
    effectiveGasPriceWei: effectiveGasPriceWei.toString(),
    l2ExecutionFeeWei: l2ExecutionFeeWei.toString(),
    l1DataFeeWei: l1DataFeeWei.toString(),
    totalFeeWei: totalFeeWei.toString(),
    totalFeeEth,
    mainnetEquivalentUsd: Number((Number(totalFeeEth) * usdPerEth).toFixed(8)),
  };
}

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
const deployment = JSON.parse(
  await readFile(resolve(projectRoot, "deployments/base-sepolia-v2.json"), "utf8"),
) as {
  version: number;
  chainId: number;
  contracts: {
    gUSD: Address;
    identityVerifier: Address;
    depositVerifier: Address;
    spendVerifier: Address;
    withdrawVerifier: Address;
    pool: Address;
  };
  entries: Array<{ name: string; blockNumber: number }>;
};
assert.equal(deployment.version, 2);
assert.equal(deployment.chainId, 84532);

const rpcUrl = required("ALCHEMY_BASE_SEPOLIA_RPC_URL");
const payerOwner = privateKeyToAccount(generatePrivateKey());
const merchantOwner = privateKeyToAccount(generatePrivateKey());
const relayUrl = process.env.GHOSTCLAW_RELAY_URL?.trim() || DEFAULT_RELAY_URL;
const payerAdapter = new SponsoredTransactionAdapter(relayUrl, payerOwner);
const merchantAdapter = new SponsoredTransactionAdapter(relayUrl, merchantOwner);
const publicClient: any = createPublicClient({
  chain: baseSepolia,
  transport: http(rpcUrl, { retryCount: 1, timeout: 60_000 }),
});
assert.equal(await publicClient.getChainId(), 84532);

const payer = getAddress(payerAdapter.account);
const merchant = getAddress(merchantAdapter.account);
assert.notEqual(payer, merchant);
const payerSpendKey = (BigInt(generatePrivateKey()) % (BN254_SCALAR_FIELD - 1n)) + 1n;
let merchantSpendKey = (BigInt(generatePrivateKey()) % (BN254_SCALAR_FIELD - 1n)) + 1n;
if (merchantSpendKey === payerSpendKey) {
  merchantSpendKey = (merchantSpendKey % (BN254_SCALAR_FIELD - 1n)) + 1n;
}
const pool = getAddress(deployment.contracts.pool);
const x402Requirement = Buffer.from(JSON.stringify({
  version: 2,
  scheme: "ghostclaw-confidential-x402-v2",
  network: "base-sepolia",
  merchant,
  asset: deployment.contracts.gUSD,
  pool,
  amount: "25",
  description: "GhostClaw Base Sepolia acceptance test",
}), "utf8");
const canonicalDigest = canonicalRequestDigest(x402Requirement);
const requestBinding = bindRequestDigest(canonicalDigest);
const proofPath = resolve(projectRoot, "deployments/base-sepolia-v2-proofs.json");
const existingLeavesPath = resolve(projectRoot, ".ghostclaw/e2e-existing-leaves.json");
const poolDeployment = deployment.entries.find((entry) => entry.name === "pool");
assert.ok(poolDeployment);
const existingTree = await collectNoteTree({
  client: publicClient,
  pool,
  fromBlock: BigInt(poolDeployment.blockNumber),
  readPool: (functionName: string, args: unknown[] = []) => publicClient.readContract({
    address: pool,
    abi: poolAbi,
    functionName,
    args,
  }),
});
await atomicJson(existingLeavesPath, existingTree.leaves);
const preparedProver = await prepareProver();
await execFileAsync(
  preparedProver.limiterBinary,
  [
    String(PROVER_MEMORY_LIMIT_BYTES),
    preparedProver.binary,
    "prove-scenario",
    "--artifacts",
    preparedProver.artifactDir,
    "--context",
    pool,
    "--payer",
    payer,
    "--merchant",
    merchant,
    "--request-digest",
    `0x${BigInt(requestBinding.digest).toString(16)}`,
    "--payer-spend-key",
    `0x${payerSpendKey.toString(16)}`,
    "--merchant-spend-key",
    `0x${merchantSpendKey.toString(16)}`,
    "--existing-leaves",
    existingLeavesPath,
    "--out",
    proofPath,
  ],
  {
    cwd: projectRoot,
    env: { ...process.env, GOMEMLIMIT: PROVER_GO_MEMORY_LIMIT },
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
  },
);
const proofs = JSON.parse(await readFile(proofPath, "utf8")) as ProofBundle;
assert.equal(proofs.protocol, "GhostClaw Confidential Payments v2");
assert.equal(BigInt(proofs.context), BigInt(pool));
assert.equal(getAddress(proofs.payer), payer);
assert.equal(getAddress(proofs.merchant), merchant);
assert.equal(await publicClient.readContract({
  address: pool,
  abi: poolAbi,
  functionName: "context",
}), BigInt(pool));

const quote = await ethUsdQuote();
const actions: Record<string, unknown> = {};

async function send(
  label: string,
  adapter: SponsoredTransactionAdapter,
  from: Address,
  request: { target: Address; signature: string; args?: unknown[] },
) {
  const abi = getAddress(request.target) === getAddress(deployment.contracts.pool)
    ? poolAbi
    : tokenAbi;
  const functionName = request.signature.slice(0, request.signature.indexOf("("));
  const data = encodeFunctionData({
    abi,
    functionName,
    args: request.args ?? [],
  } as never);
  const contractCallGasEstimate = await publicClient.estimateGas({
    account: from,
    to: request.target,
    data,
    value: 0n,
  }).catch(() => null);
  const started = performance.now();
  const sent = await adapter.send(request.target, request.signature, request.args ?? []);
  const confirmationMs = performance.now() - started;
  const raw = await publicClient.request({
    method: "eth_getTransactionReceipt",
    params: [sent.transactionHash],
  }) as RawReceipt;
  assert.equal(BigInt(raw.status), 1n);
  const record = {
    ...sent,
    confirmationMs: Number(confirmationMs.toFixed(2)),
    contractCallGasEstimate: contractCallGasEstimate?.toString() ?? null,
    cost: cost(raw, quote.usdPerEth),
  };
  actions[label] = record;
  return record;
}

for (const [label, clients, account, identity] of [
  ["registerPayer", payerAdapter, payer, proofs.identities.payer],
  ["registerMerchant", merchantAdapter, merchant, proofs.identities.merchant],
] as const) {
  const current = await publicClient.readContract({
    address: pool,
    abi: poolAbi,
    functionName: "ownerOf",
    args: [account],
  });
  if (current === 0n) {
    await send(label, clients, account, {
      target: pool,
      signature: "registerSelf(bytes,uint256)",
      args: [identity.proof.proof, BigInt(identity.owner)],
    });
  } else {
    assert.equal(current, BigInt(identity.owner));
  }
}

const amount = BigInt(proofs.deposit.amount);
const [balance, faucetUsed] = await Promise.all([
  publicClient.readContract({
    address: deployment.contracts.gUSD,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [payer],
  }),
  publicClient.readContract({
    address: deployment.contracts.gUSD,
    abi: tokenAbi,
    functionName: "faucetUsed",
    args: [payer],
  }),
]);
if (balance < amount) {
  assert.equal(faucetUsed, false);
  await send("faucet", payerAdapter, payer, {
    target: deployment.contracts.gUSD,
    signature: "faucet()",
  });
}
await send("approve", payerAdapter, payer, {
  target: deployment.contracts.gUSD,
  signature: "approve(address,uint256)",
  args: [pool, amount],
});

await send("deposit", payerAdapter, payer, {
  target: pool,
  signature: "deposit(bytes,uint256,uint64)",
  args: [proofs.deposit.proof.proof, BigInt(proofs.deposit.commitment), amount],
});
assert.equal(await publicClient.readContract({
  address: pool,
  abi: poolAbi,
  functionName: "currentRoot",
}), BigInt(proofs.payment.spendRoot));

const paymentRecord = await send("payment", payerAdapter, payer, {
  target: pool,
  signature: "confidentialTransfer(bytes,uint256,uint256,uint256,uint256,uint256,uint256,address)",
  args: [
    proofs.payment.proof.proof,
    BigInt(proofs.payment.spendRoot),
    BigInt(proofs.payment.nullifier),
    BigInt(proofs.payment.outputLeft),
    BigInt(proofs.payment.outputRight),
    BigInt(proofs.payment.recipientOwner),
    BigInt(proofs.payment.paymentIntent),
    merchant,
  ],
});
assert.equal(await publicClient.readContract({
  address: pool,
  abi: poolAbi,
  functionName: "currentRoot",
}), BigInt(proofs.withdraw.spendRoot));
assert.equal(await publicClient.readContract({
  address: pool,
  abi: poolAbi,
  functionName: "settledPaymentIntents",
  args: [BigInt(proofs.payment.paymentIntent)],
}), true);

const merchantNoteKeys = generateKeyPairSync("x25519");
const merchantState = {
  owner: proofs.owners.merchant,
  noteEncryptionPrivateKey: merchantNoteKeys.privateKey
    .export({ format: "der", type: "pkcs8" })
    .toString("base64"),
  receivedSettlements: [] as unknown[],
};
const recipientNote = {
  amount: "25000000",
  owner: proofs.owners.merchant,
  blinding: "8194",
  commitment: proofs.payment.recipientCommitment,
  outputPosition: proofs.payment.outputLeft === proofs.payment.recipientCommitment ? 0 : 1,
};
const noteEnvelope = encryptNote(
  recipientNote,
  merchantNoteKeys.publicKey.export({ format: "der", type: "spki" }).toString("base64"),
  merchant,
  proofs.payment.paymentIntent,
);
const paymentResponse = {
  version: 2,
  scheme: "ghostclaw-confidential-x402-v2",
  network: "base-sepolia",
  merchant,
  paymentIntent: proofs.payment.paymentIntent,
  transactionHash: paymentRecord.transactionHash,
  requestBindingSalt: requestBinding.salt,
  noteEnvelope,
};
const readPool = (functionName: string, args: unknown[] = []) => publicClient.readContract({
  address: pool,
  abi: poolAbi,
  functionName,
  args,
});
const merchantAcceptance = await validatePaymentResponse({
  payload: paymentResponse,
  state: merchantState,
  account: merchant,
  canonicalDigest,
  publicClient,
  readPool,
  inspectReceivedPayment,
  confirmations: 1,
});
assert.equal(merchantAcceptance.note.commitment, proofs.payment.recipientCommitment);
assert.equal(merchantAcceptance.note.amount, "25000000");
merchantState.receivedSettlements.push(merchantAcceptance.evidence);
await assert.rejects(() => validatePaymentResponse({
  payload: paymentResponse,
  state: merchantState,
  account: merchant,
  canonicalDigest,
  publicClient,
  readPool,
  inspectReceivedPayment,
  confirmations: 1,
}));

await send("withdrawal", payerAdapter, payer, {
  target: pool,
  signature: "withdraw(bytes,uint256,uint256,uint256,address,uint64)",
  args: [
    proofs.withdraw.proof.proof,
    BigInt(proofs.withdraw.spendRoot),
    BigInt(proofs.withdraw.nullifier),
    BigInt(proofs.withdraw.changeCommitment),
    payer,
    BigInt(proofs.withdraw.amount),
  ],
});
assert.equal(await publicClient.readContract({
  address: pool,
  abi: poolAbi,
  functionName: "nullifiers",
  args: [BigInt(proofs.withdraw.nullifier)],
}), true);

const recoveryOwner = privateKeyToAccount(generatePrivateKey());
const recoveryAdapter = new SponsoredTransactionAdapter(relayUrl, recoveryOwner);
const payerPrivateOwner = BigInt(proofs.owners.payer);
const recoveryNonce = await publicClient.readContract({
  address: pool,
  abi: poolAbi,
  functionName: "identityNonce",
  args: [payerPrivateOwner],
});
const recoveryProof = await prove("prove-identity", {
  context: pool,
  spendKey: payerSpendKey.toString(),
  account: recoveryOwner.address,
  action: "3",
  nonce: recoveryNonce.toString(),
});
assert.equal(BigInt(recoveryProof.owner), payerPrivateOwner);
const recoveryDeadline = BigInt(Math.floor(Date.now() / 1_000) + 3_600);
const recoveryConsentDigest = await publicClient.readContract({
  address: pool,
  abi: poolAbi,
  functionName: "accountConsentDigest",
  args: [
    payerPrivateOwner,
    payer,
    recoveryOwner.address,
    3n,
    recoveryNonce,
    recoveryDeadline,
  ],
});
const recoveryConsent = await recoveryOwner.signMessage({
  message: { raw: recoveryConsentDigest },
});
await send("requestRecovery", recoveryAdapter, recoveryOwner.address, {
  target: pool,
  signature: "requestRecovery(bytes,uint256,address,uint256,bytes)",
  args: [
    recoveryProof.proof.proof,
    payerPrivateOwner,
    recoveryOwner.address,
    recoveryDeadline,
    recoveryConsent,
  ],
});
const pendingRecovery = await publicClient.readContract({
  address: pool,
  abi: poolAbi,
  functionName: "pendingRecovery",
  args: [payerPrivateOwner],
});
assert.equal(getAddress(pendingRecovery[1]), recoveryOwner.address);
assert.ok(BigInt(pendingRecovery[2]) > BigInt(Math.floor(Date.now() / 1_000)));
await send("cancelRecovery", payerAdapter, payer, {
  target: pool,
  signature: "cancelRecovery(uint256)",
  args: [payerPrivateOwner],
});
const cancelledRecovery = await publicClient.readContract({
  address: pool,
  abi: poolAbi,
  functionName: "pendingRecovery",
  args: [payerPrivateOwner],
});
assert.equal(cancelledRecovery[1], "0x0000000000000000000000000000000000000000");

const verifierGas = {
  identity: (await publicClient.estimateContractGas({
    account: payer,
    address: deployment.contracts.identityVerifier,
    abi: verifierAbi,
    functionName: "Verify",
    args: [proofs.identities.payer.proof.proof, proofs.identities.payer.proof.publicInputs.map(BigInt)],
  })).toString(),
  deposit: (await publicClient.estimateContractGas({
    account: payer,
    address: deployment.contracts.depositVerifier,
    abi: verifierAbi,
    functionName: "Verify",
    args: [proofs.deposit.proof.proof, proofs.deposit.proof.publicInputs.map(BigInt)],
  })).toString(),
  payment: (await publicClient.estimateContractGas({
    account: payer,
    address: deployment.contracts.spendVerifier,
    abi: verifierAbi,
    functionName: "Verify",
    args: [proofs.payment.proof.proof, proofs.payment.proof.publicInputs.map(BigInt)],
  })).toString(),
  withdrawal: (await publicClient.estimateContractGas({
    account: payer,
    address: deployment.contracts.withdrawVerifier,
    abi: verifierAbi,
    functionName: "Verify",
    args: [proofs.withdraw.proof.proof, proofs.withdraw.proof.publicInputs.map(BigInt)],
  })).toString(),
};
const evidence = {
  version: 2,
  generatedAt: new Date().toISOString(),
  chainId: 84532,
  status: "verified-live-testnet-only",
  productionSafe: false,
  model: "depth-20-append-only-note-tree",
  startingLeafCount: existingTree.leaves.length,
  proofSystem: "Consensys gnark PLONK on BN254",
  universalSrs: "Aztec Ignition",
  projectSpecificCeremony: false,
  contracts: deployment.contracts,
  accounts: { payer, merchant },
  quote,
  proofTimesMs: {
    identity: proofs.identities.payer.proof.proveMs,
    deposit: proofs.deposit.proof.proveMs,
    payment: proofs.payment.proof.proveMs,
    withdrawal: proofs.withdraw.proof.proveMs,
  },
  nativeVerifyTimesMs: {
    identity: proofs.identities.payer.proof.verifyMs,
    deposit: proofs.deposit.proof.verifyMs,
    payment: proofs.payment.proof.verifyMs,
    withdrawal: proofs.withdraw.proof.verifyMs,
  },
  proofBytes: (proofs.payment.proof.proof.length - 2) / 2,
  verifierGas,
  actions,
  merchantAcceptance: {
    accepted: true,
    replayRejected: true,
    paymentIntent: merchantAcceptance.evidence.paymentIntent,
    transactionHash: merchantAcceptance.evidence.transactionHash,
    recipientCommitment: merchantAcceptance.evidence.recipientCommitment,
    root: merchantAcceptance.evidence.root,
    confirmations: merchantAcceptance.evidence.confirmations,
  },
  recoveryAcceptance: {
    requested: true,
    sevenDayDelayObserved: true,
    cancelledByCurrentAccount: true,
    proposedAccount: recoveryOwner.address,
  },
  observedState: {
    paymentIntentSettled: true,
    depositNullifierSpent: await publicClient.readContract({
      address: pool,
      abi: poolAbi,
      functionName: "nullifiers",
      args: [BigInt(proofs.payment.nullifier)],
    }),
    withdrawalNullifierSpent: true,
    currentRoot: (await publicClient.readContract({
      address: pool,
      abi: poolAbi,
      functionName: "currentRoot",
    })).toString(),
    totalEscrowed: (await publicClient.readContract({
      address: pool,
      abi: poolAbi,
      functionName: "totalEscrowed",
    })).toString(),
    poolTokenBalance: (await publicClient.readContract({
      address: deployment.contracts.gUSD,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [pool],
    })).toString(),
  },
};
assert.equal(evidence.observedState.totalEscrowed, evidence.observedState.poolTokenBalance);
await atomicJson(resolve(projectRoot, "benchmark-results/base-sepolia-v2-e2e.json"), evidence);
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
