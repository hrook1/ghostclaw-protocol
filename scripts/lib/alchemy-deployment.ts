import { estimateFeesPerGas } from "@alchemy/aa-infra";
import { alchemyTransport } from "@alchemy/common";
import { toModularAccountV2 } from "@alchemy/smart-accounts";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { Wallet } from "ethers";
import {
  createPublicClient,
  type Call,
  type LocalAccount,
  type PublicClient,
} from "viem";
import { createBundlerClient } from "viem/account-abstraction";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

async function requirePrivateFile(path: string, label: string) {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) {
    throw new Error(`${label} must be a regular file with mode 0600.`);
  }
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
    throw new Error(`${label} must belong to the current operating-system user.`);
  }
}

export async function loadEncryptedKeystoreOwner(input: {
  keystorePath: string;
  passwordFile: string;
}) {
  const keystorePath = resolve(input.keystorePath);
  const passwordFile = resolve(input.passwordFile);
  await Promise.all([
    requirePrivateFile(keystorePath, "The operator keystore"),
    requirePrivateFile(passwordFile, "The operator password file"),
  ]);
  const password = Buffer.from((await readFile(passwordFile, "utf8")).trim(), "utf8");
  try {
    const decrypted = await Wallet.fromEncryptedJson(
      await readFile(keystorePath, "utf8"),
      password.toString("utf8"),
    );
    return privateKeyToAccount(decrypted.privateKey as `0x${string}`);
  } finally {
    password.fill(0);
  }
}

export async function createDeploymentClients(input: {
  rpcUrl: string;
  policyId: string;
  owner: LocalAccount;
}) {
  if (!input.rpcUrl.startsWith("https://")) {
    throw new Error("The Alchemy RPC URL must use HTTPS.");
  }
  if (!input.policyId.trim()) {
    throw new Error("An Alchemy bundler sponsorship policy ID is required.");
  }
  const transport = alchemyTransport({
    url: input.rpcUrl,
    fetchOptions: {
      headers: { "x-alchemy-policy-id": input.policyId },
    },
    retryCount: 0,
    timeout: 60_000,
  });
  const rawPublicClient = createPublicClient({
    chain: baseSepolia,
    transport,
  });
  const account = await toModularAccountV2({
    // Wallet API beta packages expose an incompatible generic account type.
    // Runtime chain, account, code, call, and receipt checks remain mandatory.
    client: rawPublicClient as never,
    owner: input.owner,
    salt: 0n,
  });
  const bundler = createBundlerClient({
    account: account as never,
    chain: baseSepolia,
    transport,
    userOperation: { estimateFeesPerGas },
  });
  return {
    account,
    bundler,
    publicClient: rawPublicClient as unknown as PublicClient,
  };
}

export async function sendDeploymentCalls(input: {
  bundler: Awaited<ReturnType<typeof createDeploymentClients>>["bundler"];
  calls: Call[];
  timeout?: number;
}) {
  const userOperationHash = await (input.bundler.sendUserOperation as Function)({
    calls: input.calls,
    maxFeePerGas: 0n,
    maxPriorityFeePerGas: 0n,
    preVerificationGas: 0n,
  });
  const receipt = await input.bundler.waitForUserOperationReceipt({
    hash: userOperationHash,
    timeout: input.timeout ?? 180_000,
  });
  if (!receipt.success) {
    throw new Error(receipt.reason ?? "The sponsored UserOperation reverted.");
  }
  return {
    userOperationHash,
    transactionHash: receipt.receipt.transactionHash,
    blockNumber: Number(receipt.receipt.blockNumber),
  };
}
