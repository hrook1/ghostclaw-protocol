import { canonicalRequestDigest } from "./protocol.mjs";
import { publicClient, readPool } from "./alchemy-adapter.mjs";
import { inspectReceivedPayment } from "./prover.mjs";
import { validatePaymentResponse } from "./settlement.mjs";
import {
  loadState,
  saveState,
  transactionAccount,
  withWalletLock,
} from "./state.mjs";

const MAX_PAYMENT_HEADER_BYTES = 128 * 1024;
const MAX_REQUIREMENT_BYTES = 64 * 1024;

function decodeBase64Json(value, maxBytes, label) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > Math.ceil(maxBytes * 4 / 3) + 4
    || !/^(?:[A-Za-z0-9+/_-]{4})*(?:[A-Za-z0-9+/_-]{2}==|[A-Za-z0-9+/_-]{3}=)?$/.test(value)
  ) {
    throw new Error(`The ${label} header is invalid.`);
  }
  const bytes = Buffer.from(value.replaceAll("-", "+").replaceAll("_", "/"), "base64");
  if (bytes.length === 0 || bytes.length > maxBytes) {
    bytes.fill(0);
    throw new Error(`The ${label} header has an invalid size.`);
  }
  let payload;
  try {
    payload = JSON.parse(bytes.toString("utf8"));
  } catch {
    bytes.fill(0);
    throw new Error(`The ${label} header does not contain valid JSON.`);
  }
  return { bytes, payload };
}

export async function localMerchantIdentity(dependencies = {}) {
  const load = dependencies.loadState ?? loadState;
  const state = await load();
  return {
    merchant: transactionAccount(state),
    noteEncryptionPublicKey: state.noteEncryptionPublicKey,
  };
}

export async function importMerchantSettlement(input, dependencies = {}) {
  const requirement = decodeBase64Json(
    input.paymentRequiredBase64,
    MAX_REQUIREMENT_BYTES,
    "PAYMENT-REQUIRED",
  );
  const payment = decodeBase64Json(
    input.paymentSignature,
    MAX_PAYMENT_HEADER_BYTES,
    "PAYMENT-SIGNATURE",
  );
  try {
    const canonicalDigest = canonicalRequestDigest(requirement.bytes);
    return await (dependencies.withWalletLock ?? withWalletLock)(async () => {
      const state = await (dependencies.loadState ?? loadState)();
      if (state.pending) {
        throw new Error("The merchant wallet has an unresolved transaction.");
      }
      const account = transactionAccount(state);
      const existing = (state.receivedSettlements ?? []).find((record) => (
        String(record.transactionHash).toLowerCase()
          === String(payment.payload?.transactionHash ?? "").toLowerCase()
        && String(record.paymentIntent) === String(payment.payload?.paymentIntent ?? "")
        && String(record.requestBindingSalt).toLowerCase()
          === String(payment.payload?.requestBindingSalt ?? "").toLowerCase()
        && String(record.canonicalRequestDigest) === String(canonicalDigest)
      ));
      if (existing) {
        return {
          status: "already-imported",
          merchant: account,
          paymentIntent: existing.paymentIntent,
          transactionHash: existing.transactionHash,
          confirmations: existing.confirmations,
        };
      }
      const verified = await validatePaymentResponse({
        payload: payment.payload,
        state,
        account,
        canonicalDigest,
        publicClient: dependencies.publicClient ?? publicClient,
        readPool: dependencies.readPool ?? readPool,
        inspectReceivedPayment: dependencies.inspectReceivedPayment ?? inspectReceivedPayment,
        confirmations: input.confirmations ?? 1,
        ...(dependencies.decodeTransactionSettlement
          ? { decodeTransactionSettlement: dependencies.decodeTransactionSettlement }
          : {}),
      });
      if (state.notes.some((note) => note.commitment === verified.note.commitment)) {
        throw new Error("The merchant wallet already contains this payment note.");
      }
      state.notes.push({
        ...verified.note,
        status: "available",
        source: "received-payment",
        paymentIntent: verified.evidence.paymentIntent,
        transactionHash: verified.evidence.transactionHash,
        createdAt: new Date().toISOString(),
      });
      state.receivedSettlements ??= [];
      state.receivedSettlements.push(verified.evidence);
      await (dependencies.saveState ?? saveState)(state);
      return {
        status: "verified-and-imported",
        merchant: account,
        paymentIntent: verified.evidence.paymentIntent,
        transactionHash: verified.evidence.transactionHash,
        confirmations: verified.evidence.confirmations,
      };
    });
  } finally {
    requirement.bytes.fill(0);
    payment.bytes.fill(0);
  }
}
