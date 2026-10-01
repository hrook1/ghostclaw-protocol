import { decodeCallsMAv2 } from "@alchemy/smart-accounts";
import { timingSafeEqual } from "node:crypto";
import {
  decodeFunctionData,
  getAddress,
  isAddress,
  size,
} from "viem";
import {
  BN254_SCALAR_FIELD,
  CHAIN_ID,
  CONTRACTS,
  poolAbi,
  tokenAbi,
} from "./protocol.mjs";

const MAX_UINT64 = 18_446_744_073_709_551_615n;
const PROOF_BYTES = 768;
const EXECUTE_USER_OP_SELECTOR = "0x8dd7712f";

const ALLOWED_SIGNATURES = new Map([
  [CONTRACTS.pool.toLowerCase(), new Set([
    "registerSelf(bytes,uint256)",
    "rotateAccount(bytes,address,uint256,bytes)",
    "requestRecovery(bytes,uint256,address,uint256,bytes)",
    "cancelRecovery(uint256)",
    "finalizeRecovery(uint256)",
    "deposit(bytes,uint256,uint64)",
    "confidentialTransfer(bytes,uint256,uint256,uint256,uint256,uint256,uint256,address)",
    "withdraw(bytes,uint256,uint256,uint256,address,uint64)",
  ])],
  [CONTRACTS.token.toLowerCase(), new Set([
    "faucet()",
    "approve(address,uint256)",
  ])],
]);

function reject(message) {
  const error = new Error(message);
  error.code = "SPONSORSHIP_REJECTED";
  throw error;
}

function requireZeroValue(value) {
  if (BigInt(value ?? 0) !== 0n) {
    reject("Native token value is outside the GhostClaw sponsorship policy.");
  }
}

function requireProof(proof) {
  if (typeof proof !== "string" || !proof.startsWith("0x")) {
    reject("The proof bytes are malformed.");
  }
  const proofBytes = size(proof);
  if (proofBytes !== PROOF_BYTES) {
    reject("The proof size is outside the GhostClaw sponsorship policy.");
  }
}

function requireUint64(value, label) {
  const amount = BigInt(value);
  if (amount <= 0n || amount > MAX_UINT64) {
    reject(`${label} is outside the GhostClaw sponsorship policy.`);
  }
}

function requireField(value, label, allowZero = false) {
  const field = BigInt(value);
  if (field < 0n || field >= BN254_SCALAR_FIELD || (!allowZero && field === 0n)) {
    reject(`${label} is outside the GhostClaw sponsorship policy.`);
  }
}

function requireConsent(address, deadline, signature) {
  if (!isAddress(address) || BigInt(deadline) <= 0n || size(signature) !== 65) {
    reject("The identity authorization is malformed.");
  }
}

function validatePoolCall(data) {
  let decoded;
  try {
    decoded = decodeFunctionData({ abi: poolAbi, data });
  } catch {
    reject("The pool call data is malformed.");
  }

  const args = decoded.args ?? [];
  switch (decoded.functionName) {
    case "registerSelf":
      requireProof(args[0]);
      requireField(args[1], "The owner");
      return decoded.functionName;
    case "rotateAccount":
      requireProof(args[0]);
      requireConsent(args[1], args[2], args[3]);
      return decoded.functionName;
    case "requestRecovery":
      requireProof(args[0]);
      requireField(args[1], "The recovery owner");
      requireConsent(args[2], args[3], args[4]);
      return decoded.functionName;
    case "cancelRecovery":
    case "finalizeRecovery":
      requireField(args[0], "The recovery owner");
      return decoded.functionName;
    case "deposit":
      requireProof(args[0]);
      requireField(args[1], "The deposit commitment");
      requireUint64(args[2], "The deposit amount");
      return decoded.functionName;
    case "confidentialTransfer":
      requireProof(args[0]);
      requireField(args[1], "The spend root");
      requireField(args[2], "The nullifier");
      requireField(args[3], "The left output");
      requireField(args[4], "The right output");
      requireField(args[5], "The recipient owner");
      requireField(args[6], "The payment intent");
      if (!isAddress(args[7])) reject("The merchant address is malformed.");
      return decoded.functionName;
    case "withdraw":
      requireProof(args[0]);
      requireField(args[1], "The spend root");
      requireField(args[2], "The nullifier");
      requireField(args[3], "The change commitment", true);
      if (!isAddress(args[4])) reject("The withdrawal recipient is malformed.");
      requireUint64(args[5], "The withdrawal amount");
      return decoded.functionName;
    default:
      reject("The pool function is outside the GhostClaw sponsorship policy.");
  }
}

function validateTokenCall(data) {
  let decoded;
  try {
    decoded = decodeFunctionData({ abi: tokenAbi, data });
  } catch {
    reject("The token call data is malformed.");
  }

  const args = decoded.args ?? [];
  switch (decoded.functionName) {
    case "faucet":
      return decoded.functionName;
    case "approve":
      if (getAddress(args[0]) !== CONTRACTS.pool) {
        reject("The token approval target is outside the GhostClaw sponsorship policy.");
      }
      requireUint64(args[1], "The token approval amount");
      return decoded.functionName;
    default:
      reject("The token function is outside the GhostClaw sponsorship policy.");
  }
}

export function assertGhostClawSignature(target, signature) {
  const address = getAddress(target);
  if (!ALLOWED_SIGNATURES.get(address.toLowerCase())?.has(signature)) {
    reject("The contract target or function is outside the GhostClaw sponsorship policy.");
  }
}

export function validateGhostClawCall(call) {
  const target = getAddress(call.to);
  requireZeroValue(call.value);
  if (target === CONTRACTS.pool) {
    return { target, functionName: validatePoolCall(call.data ?? "0x") };
  }
  if (target === CONTRACTS.token) {
    return { target, functionName: validateTokenCall(call.data ?? "0x") };
  }
  reject("The contract target is outside the GhostClaw sponsorship policy.");
}

export function validateGhostClawCalls(calls) {
  return calls.map(validateGhostClawCall);
}

export function validateGhostClawUserOperation(userOperation) {
  if (!userOperation || typeof userOperation !== "object") {
    reject("The UserOperation is missing.");
  }
  const sender = getAddress(userOperation.sender);
  let callData = userOperation.callData;
  if (typeof callData !== "string" || !callData.startsWith("0x")) {
    reject("The UserOperation call data is malformed.");
  }
  if (callData.toLowerCase().startsWith(EXECUTE_USER_OP_SELECTOR)) {
    callData = `0x${callData.slice(10)}`;
  }
  const calls = decodeCallsMAv2(callData, sender);
  if (calls.length < 1 || calls.length > 3) {
    reject("The call count is outside the GhostClaw sponsorship policy.");
  }
  return {
    sender,
    calls,
    acceptedCalls: validateGhostClawCalls(calls),
  };
}

function sameSecret(actual, expected) {
  const actualBytes = Buffer.from(String(actual ?? ""));
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length
    && timingSafeEqual(actualBytes, expectedBytes);
}

export function evaluateSponsorship(payload, expectedPolicyId, webhookSecret) {
  try {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      reject("The sponsorship request body is malformed.");
    }
    if (String(payload.policyId ?? "") !== expectedPolicyId) {
      reject("The sponsorship policy ID does not match.");
    }
    if (webhookSecret && !sameSecret(payload.webhookData, webhookSecret)) {
      reject("The sponsorship callback is not authenticated.");
    }
    const chainId = BigInt(payload.chainId);
    if (chainId !== BigInt(CHAIN_ID)) {
      reject("The chain is outside the GhostClaw sponsorship policy.");
    }

    const result = validateGhostClawUserOperation(payload.userOperation);
    return {
      approved: true,
      sender: result.sender,
      calls: result.calls,
      acceptedCalls: result.acceptedCalls,
    };
  } catch (error) {
    return {
      approved: false,
      reason: error?.code === "SPONSORSHIP_REJECTED"
        ? error.message
        : "The sponsorship request failed validation.",
    };
  }
}
