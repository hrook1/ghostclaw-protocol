import { decodeCallsMAv2 } from "@alchemy/smart-accounts";
import {
  decodeEventLog,
  decodeFunctionData,
  getAddress,
} from "viem";
import { entryPoint07Abi, entryPoint07Address } from "viem/account-abstraction";
import {
  CHAIN_ID,
  CONTRACTS,
  NETWORK,
  bindRequestDigest,
  parseField,
  poolAbi,
} from "./protocol.mjs";
import { decryptNote } from "./state.mjs";

const EXECUTE_USER_OP_SELECTOR = "0x8dd7712f";
const TRANSACTION_HASH = /^0x[0-9a-f]{64}$/i;
const REQUEST_SALT = /^[0-9a-f]{64}$/i;

function replayRecords(state) {
  return Array.isArray(state.receivedSettlements) ? state.receivedSettlements : [];
}

function requireNoReplay(state, response) {
  const transactionHash = response.transactionHash.toLowerCase();
  const paymentIntent = String(response.paymentIntent);
  const requestBindingSalt = response.requestBindingSalt.toLowerCase();
  if (replayRecords(state).some((record) => (
    String(record.paymentIntent) === paymentIntent
    || String(record.transactionHash).toLowerCase() === transactionHash
    || String(record.requestBindingSalt).toLowerCase() === requestBindingSalt
  ))) {
    throw new Error("The payment response was already accepted by this wallet.");
  }
}

function settlementEvents(receipt) {
  const events = [];
  for (const log of receipt.logs ?? []) {
    if (getAddress(log.address) !== CONTRACTS.pool) continue;
    try {
      const decoded = decodeEventLog({
        abi: poolAbi,
        data: log.data,
        topics: log.topics,
        eventName: "X402Settlement",
        strict: true,
      });
      events.push(decoded.args);
    } catch {
      // Other pool events can share the same transaction receipt.
    }
  }
  return events;
}

export function decodeSettlementCall(transaction, payer) {
  if (getAddress(transaction.to) !== getAddress(entryPoint07Address)) {
    throw new Error("The settlement transaction did not use the expected EntryPoint.");
  }
  if (transaction.chainId !== undefined && Number(transaction.chainId) !== CHAIN_ID) {
    throw new Error("The settlement transaction targets another chain.");
  }
  const entryPointCall = decodeFunctionData({ abi: entryPoint07Abi, data: transaction.input });
  if (entryPointCall.functionName !== "handleOps") {
    throw new Error("The settlement transaction uses an unsupported EntryPoint call.");
  }
  const operations = entryPointCall.args?.[0] ?? [];
  const operation = operations.find((item) => getAddress(item.sender) === getAddress(payer));
  if (!operation) throw new Error("The settlement transaction does not contain the payer operation.");

  let callData = operation.callData;
  if (callData.toLowerCase().startsWith(EXECUTE_USER_OP_SELECTOR)) {
    callData = `0x${callData.slice(10)}`;
  }
  const calls = decodeCallsMAv2(callData, getAddress(payer));
  const settlements = [];
  for (const call of calls) {
    if (getAddress(call.to) !== CONTRACTS.pool || BigInt(call.value ?? 0) !== 0n) continue;
    let decoded;
    try {
      decoded = decodeFunctionData({ abi: poolAbi, data: call.data });
    } catch {
      continue;
    }
    if (decoded.functionName === "confidentialTransfer") settlements.push(decoded.args);
  }
  if (settlements.length !== 1) {
    throw new Error("The payer operation must contain one confidential settlement.");
  }
  const args = settlements[0];
  return {
    spendRoot: args[1],
    nullifier: args[2],
    outputLeft: args[3],
    outputRight: args[4],
    recipientOwner: args[5],
    paymentIntent: args[6],
    merchant: getAddress(args[7]),
  };
}

function requireStructuredResponse(payload, account) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !payload.noteEnvelope) {
    throw new Error("A complete GhostClaw payment response is required.");
  }
  if (
    payload.version !== 2
    || payload.scheme !== "ghostclaw-confidential-x402-v2"
    || payload.network !== NETWORK
    || getAddress(payload.merchant) !== getAddress(account)
  ) {
    throw new Error("The GhostClaw payment response is invalid for this merchant.");
  }
  if (!TRANSACTION_HASH.test(String(payload.transactionHash ?? ""))) {
    throw new Error("The payment response has no valid transaction hash.");
  }
  if (!REQUEST_SALT.test(String(payload.requestBindingSalt ?? ""))) {
    throw new Error("The payment response has no valid request binding salt.");
  }
  parseField(payload.paymentIntent, "The payment intent");
  if (String(payload.paymentIntent) !== String(payload.noteEnvelope.paymentIntent)) {
    throw new Error("The payment response and note use different payment intents.");
  }
  if (getAddress(payload.noteEnvelope.recipient) !== getAddress(account)) {
    throw new Error("The encrypted note has a different recipient.");
  }
  return payload;
}

async function validatedPublicSettlement(options) {
  const {
    payload,
    account,
    publicClient,
    readPool,
    confirmations = 1,
    decodeTransactionSettlement = decodeSettlementCall,
  } = options;
  if (!Number.isSafeInteger(confirmations) || confirmations < 1 || confirmations > 1_000) {
    throw new Error("The confirmation count must be an integer from 1 through 1,000.");
  }
  const response = requireStructuredResponse(payload, account);
  const hash = response.transactionHash;
  const [receipt, transaction, currentBlock] = await Promise.all([
    publicClient.getTransactionReceipt({ hash }),
    publicClient.getTransaction({ hash }),
    publicClient.getBlockNumber(),
  ]);
  if (receipt.status !== "success" || receipt.transactionHash.toLowerCase() !== hash.toLowerCase()) {
    throw new Error("The settlement transaction did not succeed.");
  }
  if (
    transaction.hash?.toLowerCase() !== hash.toLowerCase()
    || transaction.blockNumber !== receipt.blockNumber
  ) {
    throw new Error("The settlement transaction and receipt do not match.");
  }
  const depth = currentBlock - receipt.blockNumber + 1n;
  if (depth < BigInt(confirmations)) {
    throw new Error("The settlement transaction does not have enough confirmations.");
  }

  const matchingEvents = settlementEvents(receipt).filter((event) => (
    String(event.paymentIntent) === String(response.paymentIntent)
    && getAddress(event.merchant) === getAddress(account)
  ));
  if (matchingEvents.length !== 1) {
    throw new Error("The receipt does not contain one matching GhostClaw settlement event.");
  }
  const event = matchingEvents[0];
  const call = decodeTransactionSettlement(transaction, event.payer);
  if (
    call.merchant !== getAddress(account)
    || String(call.paymentIntent) !== String(event.paymentIntent)
    || String(call.nullifier) !== String(event.nullifier)
    || String(call.outputLeft) !== String(event.outputLeft)
    || String(call.outputRight) !== String(event.outputRight)
    || String(call.recipientOwner) !== String(event.recipientOwner)
  ) {
    throw new Error("The settlement call does not match its confirmed event.");
  }

  const [leftCommitment, rightCommitment, knownRoot, spentNullifier, settledIntent] = await Promise.all([
    readPool("commitments", [BigInt(call.outputLeft)]),
    readPool("commitments", [BigInt(call.outputRight)]),
    readPool("roots", [BigInt(event.root)]),
    readPool("nullifiers", [BigInt(event.nullifier)]),
    readPool("settledPaymentIntents", [BigInt(event.paymentIntent)]),
  ]);
  if (!leftCommitment || !rightCommitment || !knownRoot || !spentNullifier || !settledIntent) {
    throw new Error("The received payment state is unavailable on Base.");
  }
  return { response, receipt, event, call, confirmations };
}

export async function validatePublicSettlement(options) {
  const checked = await validatedPublicSettlement(options);
  return {
    status: "settled",
    scheme: "ghostclaw-confidential-x402-v2",
    merchant: getAddress(options.account),
    payer: getAddress(checked.event.payer),
    paymentIntent: String(checked.event.paymentIntent),
    transactionHash: checked.response.transactionHash,
    blockNumber: checked.receipt.blockNumber.toString(),
    confirmations: checked.confirmations,
  };
}

export async function validatePaymentResponse(options) {
  const {
    payload,
    state,
    account,
    canonicalDigest,
    inspectReceivedPayment,
  } = options;
  const checked = await validatedPublicSettlement(options);
  const { response, receipt, event, call, confirmations } = checked;
  requireNoReplay(state, response);
  const note = decryptNote(response.noteEnvelope, state);
  if (BigInt(note.owner) !== BigInt(state.owner)) {
    throw new Error("The received note owner does not match this wallet.");
  }

  const boundRequest = bindRequestDigest(canonicalDigest, response.requestBindingSalt);
  const senderOwner = BigInt(event.senderOwner);
  const recipientOwner = BigInt(event.recipientOwner);
  if (recipientOwner === 0n || recipientOwner !== BigInt(state.owner)) {
    throw new Error("The merchant identity does not match this wallet.");
  }
  if (BigInt(call.recipientOwner) !== recipientOwner) {
    throw new Error("The settlement call uses a different merchant owner.");
  }
  const inspected = await inspectReceivedPayment({
    context: CONTRACTS.pool,
    payer: event.payer,
    merchant: account,
    senderOwner: senderOwner.toString(),
    recipientOwner: recipientOwner.toString(),
    requestDigest: boundRequest.digest,
    outputLeft: call.outputLeft.toString(),
    outputRight: call.outputRight.toString(),
    note,
  });
  const publicRecipientCommitment = Number(inspected.outputPosition) === 0
    ? call.outputLeft
    : call.outputRight;
  if (
    String(inspected.recipientCommitment) !== String(publicRecipientCommitment)
    || String(inspected.paymentIntent) !== String(call.paymentIntent)
  ) {
    throw new Error("The private note does not match the settled payment call.");
  }

  return {
    note,
    evidence: {
      paymentIntent: String(inspected.paymentIntent),
      transactionHash: response.transactionHash,
      requestBindingSalt: response.requestBindingSalt.toLowerCase(),
      canonicalRequestDigest: String(canonicalDigest),
      payer: getAddress(event.payer),
      merchant: getAddress(account),
      recipientCommitment: String(inspected.recipientCommitment),
      outputLeft: String(call.outputLeft),
      outputRight: String(call.outputRight),
      pairIndex: String(event.pairIndex),
      root: String(event.root),
      blockNumber: receipt.blockNumber.toString(),
      confirmations,
      acceptedAt: new Date().toISOString(),
    },
  };
}
