import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAIN_ID } from "./protocol.mjs";

function externalModulePath() {
  const configured = process.env.GHOSTCLAW_TRANSACTION_SIGNER_MODULE?.trim();
  if (!configured) return null;
  return isAbsolute(configured) ? configured : resolve(configured);
}

async function requireSafeModule(path) {
  const canonical = await realpath(path);
  const details = await lstat(canonical);
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error("The external transaction signer module must be a regular file.");
  }
  if (typeof process.getuid === "function" && details.uid !== process.getuid()) {
    throw new Error("The external transaction signer module must belong to the current user.");
  }
  if ((details.mode & 0o022) !== 0) {
    throw new Error("The external transaction signer module must not be writable by another user.");
  }
  return canonical;
}

function checkedSigner(signer, expectedAddress) {
  if (
    !signer
    || typeof signer !== "object"
    || typeof signer.address !== "string"
    || typeof signer.signMessage !== "function"
    || typeof signer.signAuthorization !== "function"
  ) {
    throw new Error("The external transaction signer does not implement the required local-account interface.");
  }
  const address = getAddress(signer.address);
  if (expectedAddress && address !== getAddress(expectedAddress)) {
    throw new Error("The external transaction signer returned another account.");
  }
  return Object.assign(signer, { address });
}

async function externalSigner(input) {
  const path = externalModulePath();
  if (!path) throw new Error("No external transaction signer module is configured.");
  const canonical = await requireSafeModule(path);
  const loaded = await import(pathToFileURL(canonical).href);
  if (typeof loaded.createGhostClawTransactionSigner !== "function") {
    throw new Error("The external signer module has no createGhostClawTransactionSigner export.");
  }
  return checkedSigner(await loaded.createGhostClawTransactionSigner({
    chainId: CHAIN_ID,
    purpose: input.purpose,
    expectedAddress: input.expectedAddress ?? null,
  }), input.expectedAddress);
}

export function usesExternalTransactionSigner() {
  return externalModulePath() !== null;
}

export async function createInitialTransactionSigner() {
  if (!usesExternalTransactionSigner()) return null;
  return externalSigner({ purpose: "setup" });
}

export async function loadTransactionSigner(state) {
  if (state.transactionSignerMode === "external") {
    return externalSigner({ purpose: "transaction", expectedAddress: state.account });
  }
  if (!state.transactionPrivateKey) {
    throw new Error("The encrypted local transaction key is unavailable.");
  }
  return privateKeyToAccount(state.transactionPrivateKey);
}

export async function createReplacementTransactionSigner(state, purpose) {
  if (state.transactionSignerMode === "external") {
    return { signer: await externalSigner({ purpose }), privateKey: null };
  }
  const { generatePrivateKey } = await import("viem/accounts");
  const privateKey = generatePrivateKey();
  return { signer: privateKeyToAccount(privateKey), privateKey };
}

export async function loadRecoveryTransactionSigner(state) {
  if (!state.recoveryAccount) {
    throw new Error("The pending recovery account is missing.");
  }
  if (state.transactionSignerMode === "external") {
    return externalSigner({ purpose: "recovery-finalize", expectedAddress: state.recoveryAccount });
  }
  if (!state.recoveryTransactionPrivateKey) {
    throw new Error("The encrypted recovery transaction key is missing.");
  }
  const signer = privateKeyToAccount(state.recoveryTransactionPrivateKey);
  if (getAddress(signer.address) !== getAddress(state.recoveryAccount)) {
    throw new Error("The encrypted recovery transaction key has another account.");
  }
  return signer;
}
