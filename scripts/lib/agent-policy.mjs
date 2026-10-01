import { randomBytes } from "node:crypto";
import { getAddress } from "viem";
import { formatTokenAmount, parseTokenAmount } from "./protocol.mjs";
import { loadAgentState, saveAgentState, withAgentLock } from "./state.mjs";

const SESSION_MS = 8 * 60 * 60 * 1_000;
const APPROVAL_TTL_MS = 15 * 60 * 1_000;

export class GhostClawBudgetError extends Error {
  constructor(request) {
    super("The payment is outside the human-approved GhostClaw budget.");
    this.name = "GhostClawBudgetError";
    this.code = "GHOSTCLAW_BUDGET_EXCEEDED";
    this.approvalId = request.id;
    this.reasons = request.reasons;
  }
}

function checkedLimit(value, name) {
  let result;
  try {
    result = BigInt(value);
  } catch {
    throw new Error(`The ${name} budget limit is invalid.`);
  }
  if (result < 0n) throw new Error(`The ${name} budget limit cannot be negative.`);
  return result;
}

function utcDay(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function refreshUsage(state, now = new Date()) {
  const started = Date.parse(state.usage.sessionStartedAt);
  if (!Number.isFinite(started) || now.getTime() - started >= SESSION_MS) {
    state.usage.sessionStartedAt = now.toISOString();
    state.usage.sessionTotal = "0";
  }
  const cutoff = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10);
  state.usage.days = Object.fromEntries(
    Object.entries(state.usage.days ?? {}).filter(([day]) => day >= cutoff),
  );
  state.approvals = Object.fromEntries(
    Object.entries(state.approvals ?? {}).filter(([, item]) => (
      item.status === "used" || Date.parse(item.expiresAt) > now.getTime()
    )).slice(-128),
  );
  const paymentCutoff = now.getTime() - 30 * 24 * 60 * 60 * 1_000;
  state.payments = Object.fromEntries(
    Object.entries(state.payments ?? {}).filter(([, item]) => (
      Date.parse(item.settledAt) >= paymentCutoff
    )).slice(-128),
  );
  return state;
}

function checkedPayment(input) {
  const amount = checkedLimit(input.amount, "payment");
  if (amount === 0n) throw new Error("The payment amount must be greater than zero.");
  if (!/^[0-9a-f]{64}$/i.test(String(input.fingerprint ?? ""))) {
    throw new Error("The payment-policy fingerprint is invalid.");
  }
  return {
    amount,
    fingerprint: input.fingerprint.toLowerCase(),
    merchant: getAddress(input.merchant),
    origin: String(input.origin),
  };
}

function policyReasons(state, payment, now) {
  const policy = state.policy;
  const reasons = [];
  const expiry = Date.parse(policy.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= now.getTime()) reasons.push("budget-expired");
  const allowlist = (policy.merchantAllowlist ?? []).map((item) => getAddress(item));
  const denylist = (policy.merchantDenylist ?? []).map((item) => getAddress(item));
  if (denylist.includes(payment.merchant)) reasons.push("merchant-denied");
  if (allowlist.length > 0 && !allowlist.includes(payment.merchant)) reasons.push("merchant-not-allowed");
  if (payment.amount > checkedLimit(policy.maxPerPayment, "per-payment")) {
    reasons.push("per-payment-limit");
  }
  if (
    BigInt(state.usage.sessionTotal ?? "0") + payment.amount
    > checkedLimit(policy.maxPerSession, "session")
  ) {
    reasons.push("session-limit");
  }
  const day = utcDay(now);
  if (
    BigInt(state.usage.days?.[day] ?? "0") + payment.amount
    > checkedLimit(policy.maxPerDay, "daily")
  ) {
    reasons.push("daily-limit");
  }
  return reasons;
}

function approvedOverride(state, fingerprint, now) {
  return Object.values(state.approvals).find((item) => (
    item.fingerprint === fingerprint
    && item.status === "approved"
    && Date.parse(item.expiresAt) > now.getTime()
  ));
}

export async function authorizePayment(input, now = new Date()) {
  const payment = checkedPayment(input);
  return withAgentLock(async () => {
    const state = refreshUsage(await loadAgentState(), now);
    const override = approvedOverride(state, payment.fingerprint, now);
    if (override) return { allowed: true, approvalId: override.id, policyOverride: true };
    const reasons = policyReasons(state, payment, now);
    if (reasons.length === 0) return { allowed: true, approvalId: null, policyOverride: false };
    let request = Object.values(state.approvals).find((item) => (
      item.fingerprint === payment.fingerprint
      && item.status === "pending"
      && Date.parse(item.expiresAt) > now.getTime()
    ));
    if (!request) {
      const id = `gca_${randomBytes(18).toString("base64url")}`;
      request = {
        id,
        fingerprint: payment.fingerprint,
        merchant: payment.merchant,
        origin: payment.origin,
        amount: payment.amount.toString(),
        reasons,
        status: "pending",
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + APPROVAL_TTL_MS).toISOString(),
      };
      state.approvals[id] = request;
      await saveAgentState(state);
    }
    throw new GhostClawBudgetError(request);
  });
}

export async function recordPaymentUsage(input, settlement, now = new Date()) {
  const payment = checkedPayment(input);
  await withAgentLock(async () => {
    const state = refreshUsage(await loadAgentState(), now);
    if (state.payments[payment.fingerprint]) return;
    if (
      settlement?.scheme !== "ghostclaw-confidential-x402-v2"
      || getAddress(settlement.merchant) !== payment.merchant
      || typeof settlement.transactionHash !== "string"
    ) {
      throw new Error("The recorded GhostClaw settlement is invalid.");
    }
    const day = utcDay(now);
    state.usage.sessionTotal = (BigInt(state.usage.sessionTotal) + payment.amount).toString();
    state.usage.days[day] = (BigInt(state.usage.days[day] ?? "0") + payment.amount).toString();
    if (input.approvalId) {
      const approval = state.approvals[input.approvalId];
      if (!approval || approval.fingerprint !== payment.fingerprint || approval.status !== "approved") {
        throw new Error("The payment budget override is unavailable.");
      }
      approval.status = "used";
      approval.usedAt = now.toISOString();
    }
    state.payments[payment.fingerprint] = {
      fingerprint: payment.fingerprint,
      merchant: payment.merchant,
      origin: payment.origin,
      amount: payment.amount.toString(),
      settlement,
      status: "settled",
      settledAt: now.toISOString(),
    };
    await saveAgentState(state);
  });
}

export async function recordedPayment(fingerprint, now = new Date()) {
  if (!/^[0-9a-f]{64}$/i.test(String(fingerprint ?? ""))) return null;
  return withAgentLock(async () => {
    const state = refreshUsage(await loadAgentState(), now);
    const payment = state.payments[fingerprint.toLowerCase()];
    return payment?.settlement ?? null;
  });
}

export async function markPaymentDelivered(fingerprint, now = new Date()) {
  if (!/^[0-9a-f]{64}$/i.test(String(fingerprint ?? ""))) {
    throw new Error("The delivered-payment fingerprint is invalid.");
  }
  await withAgentLock(async () => {
    const state = refreshUsage(await loadAgentState(), now);
    const payment = state.payments[fingerprint.toLowerCase()];
    if (!payment) throw new Error("The delivered settlement is unavailable.");
    delete state.payments[fingerprint.toLowerCase()];
    await saveAgentState(state);
  });
}

export async function getPublicPolicy(now = new Date()) {
  const state = refreshUsage(await loadAgentState(), now);
  const day = utcDay(now);
  const policy = state.policy;
  const sessionLimit = checkedLimit(policy.maxPerSession, "session");
  const dailyLimit = checkedLimit(policy.maxPerDay, "daily");
  const sessionUsed = BigInt(state.usage.sessionTotal ?? "0");
  const dailyUsed = BigInt(state.usage.days?.[day] ?? "0");
  return {
    maxPerPayment: formatTokenAmount(policy.maxPerPayment),
    maxPerSession: formatTokenAmount(policy.maxPerSession),
    maxPerDay: formatTokenAmount(policy.maxPerDay),
    remainingSession: formatTokenAmount(sessionUsed >= sessionLimit ? 0n : sessionLimit - sessionUsed),
    remainingToday: formatTokenAmount(dailyUsed >= dailyLimit ? 0n : dailyLimit - dailyUsed),
    merchantAllowlist: policy.merchantAllowlist,
    merchantDenylist: policy.merchantDenylist,
    expiresAt: policy.expiresAt,
    sessionStartedAt: state.usage.sessionStartedAt,
  };
}

export async function setHumanPolicy(input, now = new Date()) {
  return withAgentLock(async () => {
    const state = refreshUsage(await loadAgentState(), now);
    const expiresAt = new Date(input.expiresAt);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime() + 60_000) {
      throw new Error("The budget expiry must be more than one minute in the future.");
    }
    if (expiresAt.getTime() > now.getTime() + 366 * 24 * 60 * 60 * 1_000) {
      throw new Error("The budget expiry cannot be more than 366 days in the future.");
    }
    const allowlist = [...new Set((input.merchantAllowlist ?? []).map((item) => getAddress(item)))];
    const denylist = [...new Set((input.merchantDenylist ?? []).map((item) => getAddress(item)))];
    if (allowlist.some((merchant) => denylist.includes(merchant))) {
      throw new Error("A merchant cannot be in both budget lists.");
    }
    const next = {
      maxPerPayment: parseTokenAmount(input.maxPerPayment).toString(),
      maxPerSession: parseTokenAmount(input.maxPerSession).toString(),
      maxPerDay: parseTokenAmount(input.maxPerDay).toString(),
      merchantAllowlist: allowlist,
      merchantDenylist: denylist,
      expiresAt: expiresAt.toISOString(),
    };
    if (BigInt(next.maxPerPayment) <= 0n) throw new Error("The per-payment limit must be greater than zero.");
    if (BigInt(next.maxPerSession) < BigInt(next.maxPerPayment)) {
      throw new Error("The session limit must be at least the per-payment limit.");
    }
    if (BigInt(next.maxPerDay) < BigInt(next.maxPerPayment)) {
      throw new Error("The daily limit must be at least the per-payment limit.");
    }
    state.policy = next;
    if (input.resetSession === true) {
      state.usage.sessionStartedAt = now.toISOString();
      state.usage.sessionTotal = "0";
    }
    await saveAgentState(state);
    return getPublicPolicy(now);
  });
}

export async function approveBudgetRequest(id, now = new Date()) {
  if (!/^gca_[A-Za-z0-9_-]{24}$/.test(String(id ?? ""))) {
    throw new Error("The budget approval identifier is invalid.");
  }
  return withAgentLock(async () => {
    const state = refreshUsage(await loadAgentState(), now);
    const request = state.approvals[id];
    if (!request || request.status !== "pending" || Date.parse(request.expiresAt) <= now.getTime()) {
      throw new Error("The budget approval request is unavailable or expired.");
    }
    request.status = "approved";
    request.approvedAt = now.toISOString();
    await saveAgentState(state);
    return {
      status: "approved",
      approvalId: request.id,
      merchant: request.merchant,
      origin: request.origin,
      amount: formatTokenAmount(request.amount),
      expiresAt: request.expiresAt,
    };
  });
}

export async function pendingBudgetRequests(now = new Date()) {
  const state = refreshUsage(await loadAgentState(), now);
  return Object.values(state.approvals)
    .filter((item) => item.status === "pending" && Date.parse(item.expiresAt) > now.getTime())
    .map((item) => ({
      approvalId: item.id,
      merchant: item.merchant,
      origin: item.origin,
      amount: formatTokenAmount(item.amount),
      reasons: item.reasons,
      expiresAt: item.expiresAt,
    }));
}
