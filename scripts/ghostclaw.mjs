#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getAddress } from "viem";
import {
  approveBudgetRequest,
  getPublicPolicy,
  pendingBudgetRequests,
  setHumanPolicy,
} from "./lib/agent-policy.mjs";
import {
  DEFAULT_RELAY_URL,
  SponsoredTransactionAdapter,
  normalizeRelayUrl,
  publicClient,
  readPool,
  readToken,
} from "./lib/alchemy-adapter.mjs";
import {
  agentClientLabel,
  connectAgentClient,
  connectedAgentClient,
  connectionSnippet,
  detectAgentClients,
  guidedDemoPrompt,
  launchConnectedAgent,
  shouldLaunchAgentClient,
} from "./lib/connect-client.mjs";
import { runDoctor } from "./lib/doctor.mjs";
import {
  CONTRACTS,
  NETWORK,
  bindRequestDigest,
  canonicalRequestDigest,
  formatTokenAmount,
  parseField,
  parseTokenAmount,
  randomField,
} from "./lib/protocol.mjs";
import {
  deriveOwner,
  benchmarkProver,
  inspectReceivedPayment,
  prepareProver,
  prove,
} from "./lib/prover.mjs";
import {
  PLAYTEST_CREDIT_AMOUNT,
  requestPlaytestAllocation,
} from "./lib/playtest-credit.mjs";
import { playtestFundingPlan, runGuidedStart } from "./lib/onboarding.mjs";
import {
  backupWallet,
  createState,
  defaultAgentState,
  encryptNote,
  loadConfig,
  loadState,
  saveConfig,
  saveAgentState,
  saveState,
  stateExists,
  restoreWallet,
  transactionAccount,
  verifyWalletBackup,
  withWalletLock,
  writeEnvelope,
  writePaymentResponse,
  outboxDir,
} from "./lib/state.mjs";
import { validatePaymentResponse } from "./lib/settlement.mjs";
import { collectNoteTree, spendInputForNote } from "./lib/tree-sync.mjs";
import { confirm, reportProgress } from "./lib/terminal.mjs";
import {
  createInitialTransactionSigner,
  createReplacementTransactionSigner,
  loadRecoveryTransactionSigner,
  loadTransactionSigner,
} from "./lib/transaction-signer.mjs";

process.umask(0o077);

function output(value) {
  process.stdout.write(`${JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item, 2)}\n`);
}

function parseOptions(argv) {
  const options = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      options._.push(item);
      continue;
    }
    const name = item.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      options[name] = true;
      continue;
    }
    options[name] = value;
    index += 1;
  }
  return options;
}

function required(options, name) {
  const value = options[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`--${name} is required.`);
  }
  return value.trim();
}

function readStdin(maxBytes) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    let bytes = 0;
    let finished = false;
    process.stdin.on("data", (chunk) => {
      if (finished) return;
      bytes += chunk.length;
      if (bytes > maxBytes) {
        finished = true;
        process.stdin.resume();
        reject(new Error("The private payment input exceeds 64 KiB."));
        return;
      }
      chunks.push(chunk);
    });
    process.stdin.once("end", () => {
      if (!finished) {
        finished = true;
        resolvePromise(Buffer.concat(chunks));
      }
    });
    process.stdin.once("error", (error) => {
      if (!finished) {
        finished = true;
        reject(error);
      }
    });
  });
}

async function readPassphraseOptions(options) {
  const allowed = new Set(["_", "file", "input"]);
  if (
    options.input !== "-"
    || options._.length !== 0
    || Object.keys(options).some((key) => !allowed.has(key))
  ) {
    throw new Error("Pass the backup passphrase through standard input with --input -.");
  }
  const input = await readStdin(1_026);
  let end = input.length;
  while (end > 0 && (input[end - 1] === 10 || input[end - 1] === 13)) end -= 1;
  const passphrase = Buffer.from(input.subarray(0, end));
  input.fill(0);
  return { file: required(options, "file"), passphrase };
}

async function readPrivateOptions(options) {
  if (options.input !== "-") {
    throw new Error("Private payment options must use --input -.");
  }
  if (options._.length !== 0 || Object.keys(options).some((key) => key !== "_" && key !== "input")) {
    throw new Error("Pass all payment fields inside the private JSON input.");
  }
  const input = await readStdin(64 * 1024);
  let values;
  try {
    values = JSON.parse(input.toString("utf8"));
  } catch {
    throw new Error("The private payment input must contain one JSON object.");
  }
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    throw new Error("The private payment input must contain one JSON object.");
  }
  const allowed = new Set([
    "merchant",
    "merchant-note-key",
    "amount",
    "request-file",
    "request-digest",
    "request-base64",
  ]);
  if (Object.keys(values).some((key) => !allowed.has(key))) {
    throw new Error("The private payment input contains an unknown field.");
  }
  return { ...options, ...values, input: undefined, privateInput: true };
}

async function readPrivateReceiveOptions(options) {
  if (options.input !== "-") {
    throw new Error("Private receive options must use --input -.");
  }
  if (options._.length !== 0 || Object.keys(options).some((key) => key !== "_" && key !== "input")) {
    throw new Error("Pass all receive fields inside the private JSON input.");
  }
  const input = await readStdin(64 * 1024);
  let values;
  try {
    values = JSON.parse(input.toString("utf8"));
  } catch {
    throw new Error("The private receive input must contain one JSON object.");
  }
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    throw new Error("The private receive input must contain one JSON object.");
  }
  const allowed = new Set([
    "payment-file",
    "request-file",
    "request-base64",
    "confirmations",
  ]);
  if (Object.keys(values).some((key) => !allowed.has(key))) {
    throw new Error("The private receive input contains an unknown field.");
  }
  return { ...options, ...values, input: undefined, privateInput: true };
}

function relayUrl(options) {
  return normalizeRelayUrl(
    options["relay-url"] ?? process.env.GHOSTCLAW_RELAY_URL ?? DEFAULT_RELAY_URL,
  );
}

async function setup(options, controls = {}) {
  if (process.env.GHOSTCLAW_MCP_CHILD === "1") {
    throw new Error("Run ghostclaw setup directly as the human user.");
  }
  const progress = controls.progress ?? reportProgress;
  const url = relayUrl(options);
  const exists = await stateExists();
  progress("Checking the local prover.");
  await prepareProver();
  progress("Checking the Base Sepolia pool.");
  const poolContext = await context();
  let created = false;
  progress(exists ? "Opening the local wallet." : "Creating the local wallet.");
  const wallet = await withWalletLock(async () => {
    if (await stateExists()) return loadState();
    const externalSigner = await createInitialTransactionSigner();
    const next = await createState(randomField(), {
      ...(externalSigner ? { externalAccount: externalSigner.address } : {}),
    });
    next.owner = await deriveOwner(poolContext, next.spendKey);
    await saveState(next);
    await saveAgentState(defaultAgentState(), true);
    await saveConfig(url);
    created = true;
    return next;
  });
  const account = transactionAccount(wallet);
  const registeredOwner = await readPool("ownerOf", [account]);
  let registration = { state: "existing", sponsored: true };
  if (registeredOwner === 0n) {
    progress("Registering the wallet on Base Sepolia.");
    await saveConfig(url);
    registration = await withWalletLock(async () => {
      const state = await loadState();
      const result = await ensureRegistered(
        state,
        account,
        new SponsoredTransactionAdapter(url, await loadTransactionSigner(state)),
      );
      await saveState(state);
      return result;
    });
  } else if (registeredOwner !== BigInt(wallet.owner)) {
    throw new Error("The Base account is registered to another private note owner.");
  }
  progress("Applying the payment budget.");
  const budget = await applyBudgetOptions(options);
  let agentConnection = null;
  const requestedClient = typeof options.connect === "string" ? options.connect : null;
  if (requestedClient && requestedClient !== "none") {
    progress("Connecting the agent client.");
    const approved = await confirm(
      `Write the GhostClaw MCP configuration for ${requestedClient}?`,
      { yes: options.yes === true },
    );
    agentConnection = approved
      ? await connectAgentClient(requestedClient, { scope: options.scope })
      : { status: "not-written", configuration: connectionSnippet() };
  } else if (!requestedClient) {
    const detected = await detectAgentClients();
    if (detected.length > 0) {
      progress("Connecting the detected agent clients.");
      const approved = await confirm(
        `Connect GhostClaw to ${detected.join(", ")}?`,
        { yes: options.yes === true },
      );
      agentConnection = approved
        ? await connectAgentClient("auto", { scope: options.scope })
        : { status: "not-written", detected, configuration: connectionSnippet() };
    } else {
      agentConnection = { status: "manual", configuration: connectionSnippet() };
    }
  }
  const result = {
    status: "ready",
    network: NETWORK,
    account,
    owner: wallet.owner,
    noteEncryptionPublicKey: wallet.noteEncryptionPublicKey,
    relay: "ghostclaw-sponsored-relay",
    transactionWallet: wallet.transactionSignerMode === "external"
      ? "external-hardware-signer-eip7702"
      : "local-eip7702",
    sponsorship: "required-for-every-write",
    localWallet: created ? "created" : "existing",
    registration,
    budget,
    agentConnection,
  };
  progress("Wallet setup is ready.");
  if (controls.emit !== false) output(result);
  return result;
}

function merchantList(value) {
  return typeof value === "string"
    ? value.split(",").map((item) => item.trim()).filter(Boolean)
    : null;
}

async function applyBudgetOptions(options) {
  const current = await getPublicPolicy();
  const changed = [
    "max-per-payment", "max-per-session", "max-per-day", "allow", "deny",
    "expires-at", "expires-in-days", "reset-session",
  ].some((name) => options[name] !== undefined);
  if (!changed) return current;
  let expiresAt = options["expires-at"] ?? current.expiresAt;
  if (options["expires-in-days"] !== undefined) {
    const days = Number(options["expires-in-days"]);
    if (!Number.isInteger(days) || days < 1 || days > 366) {
      throw new Error("--expires-in-days must be 1 through 366.");
    }
    expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1_000).toISOString();
  }
  return setHumanPolicy({
    maxPerPayment: options["max-per-payment"] ?? current.maxPerPayment,
    maxPerSession: options["max-per-session"] ?? current.maxPerSession,
    maxPerDay: options["max-per-day"] ?? current.maxPerDay,
    merchantAllowlist: merchantList(options.allow) ?? current.merchantAllowlist,
    merchantDenylist: merchantList(options.deny) ?? current.merchantDenylist,
    expiresAt,
    resetSession: options["reset-session"] === true,
  });
}

async function context() {
  const value = await readPool("context");
  if (value !== BigInt(CONTRACTS.pool)) {
    throw new Error("The deployed pool context does not match its address.");
  }
  return CONTRACTS.pool;
}

async function checkedWallet() {
  const [config, state] = await Promise.all([
    loadConfig(),
    loadState(),
  ]);
  const account = transactionAccount(state);
  if (!state.account || getAddress(state.account) !== account) {
    throw new Error("The local note wallet and transaction key do not match.");
  }
  const adapter = new SponsoredTransactionAdapter(config.relayUrl, await loadTransactionSigner(state));
  return { config, state, account, adapter };
}

async function ensureRegistered(state, account, adapter) {
  const poolContext = await context();
  state.owner ??= await deriveOwner(poolContext, state.spendKey);
  const registered = await readPool("ownerOf", [account]);
  if (registered === 0n) {
    const bundle = await prove("prove-identity", {
      context: poolContext,
      spendKey: state.spendKey,
      account,
      action: "1",
      nonce: "0",
    });
    if (bundle.owner !== state.owner) {
      throw new Error("The identity proof returned another private owner.");
    }
    const receipt = await adapter.registerSelf(bundle);
    const confirmed = await readPool("ownerOf", [account]);
    if (confirmed !== BigInt(state.owner)) {
      throw new Error("The pool did not record the GhostClaw owner.");
    }
    return { state: "created", transactionHash: receipt.transactionHash, sponsored: true };
  }
  if (registered !== BigInt(state.owner)) {
    throw new Error("The pool account is registered to a different private note owner.");
  }
  return { state: "existing", sponsored: true };
}

function addNote(state, note, metadata) {
  if (state.notes.some((item) => item.commitment === note.commitment)) return;
  state.notes.push({
    ...note,
    status: "available",
    createdAt: new Date().toISOString(),
    ...metadata,
  });
}

function spendNote(state, commitment, transactionHash) {
  const note = state.notes.find((item) => item.commitment === commitment);
  if (!note) throw new Error("The input note is missing from local state.");
  note.status = "spent";
  note.spentAt = new Date().toISOString();
  note.spentBy = transactionHash;
}

async function finalizePending(state) {
  const pending = state.pending;
  if (!pending) return null;
  let landed = false;
  if (pending.kind === "deposit") {
    landed = await readPool("commitments", [BigInt(pending.bundle.commitment)]);
  } else {
    landed = await readPool("nullifiers", [BigInt(pending.bundle.nullifier)]);
  }
  if (!landed) return { recovered: false, kind: pending.kind };

  await collectNoteTree();

  const transactionHash = pending.transactionHash ?? null;
  if (pending.kind === "deposit") {
    addNote(state, pending.bundle.note, { source: "deposit", transactionHash });
  } else if (pending.kind === "payment") {
    spendNote(state, pending.inputCommitment, transactionHash);
    addNote(state, pending.bundle.changeNote, { source: "change", transactionHash });
    await writeEnvelope(pending.envelope);
    await writePaymentResponse({
      version: 2,
      scheme: "ghostclaw-confidential-x402-v2",
      network: NETWORK,
      merchant: pending.merchant,
      paymentIntent: pending.bundle.paymentIntent,
      transactionHash,
      requestBindingSalt: pending.requestBindingSalt,
      noteEnvelope: pending.envelope,
    });
  } else if (pending.kind === "withdrawal") {
    spendNote(state, pending.inputCommitment, transactionHash);
    if (pending.bundle.changeNote) {
      addNote(state, pending.bundle.changeNote, { source: "withdrawal-change", transactionHash });
    }
  }
  state.history.push({
    action: pending.kind,
    amount: pending.amount,
    transactionHash,
    completedAt: new Date().toISOString(),
  });
  state.pending = null;
  await saveState(state);
  return {
    recovered: true,
    kind: pending.kind,
    transactionHash,
    ...(pending.kind === "payment" ? { paymentIntent: pending.bundle.paymentIntent } : {}),
  };
}

async function requireNoPending(state) {
  if (!state.pending) return;
  const recovery = await finalizePending(state);
  if (!recovery?.recovered) {
    throw new Error("A prepared transaction is unresolved. Run `ghostclaw recover`.");
  }
}

async function performDeposit(amount, selectedWallet = null) {
  const { state, account, adapter } = selectedWallet ?? await checkedWallet();
  await requireNoPending(state);
  await ensureRegistered(state, account, adapter);
  const bundle = await prove("prove-deposit", {
    context: await context(),
    spendKey: state.spendKey,
    amount: amount.toString(),
    blinding: randomField(),
  });
  if (await readPool("commitments", [BigInt(bundle.commitment)])) {
    throw new Error("The new deposit commitment already exists.");
  }

  const balance = await readToken("balanceOf", [account]);
  if (balance < amount) {
    throw new Error("The public wallet has insufficient gUSD. Run `ghostclaw claim` first.");
  }
  if (await readToken("allowance", [account, CONTRACTS.pool]) < amount) {
    await adapter.approve(amount);
  }

  state.pending = {
    kind: "deposit",
    amount: amount.toString(),
    bundle,
    preparedAt: new Date().toISOString(),
  };
  await saveState(state);
  const receipt = await adapter.deposit(bundle);
  state.pending.transactionHash = receipt.transactionHash;
  const recovery = await finalizePending(state);
  if (!recovery?.recovered) throw new Error("The confirmed deposit root is unavailable.");
  return {
    status: "confirmed",
    action: "deposit",
    amount: formatTokenAmount(amount),
    commitment: bundle.commitment,
    transactionHash: receipt.transactionHash,
    sponsored: true,
  };
}

async function deposit(options, controls = {}) {
  const amount = parseTokenAmount(required(options, "amount"));
  const result = await withWalletLock(() => performDeposit(amount));
  if (controls.emit !== false) output(result);
  return result;
}

async function performClaim(selectedWallet = null) {
  const { state, account, adapter } = selectedWallet ?? await checkedWallet();
  await requireNoPending(state);
  await ensureRegistered(state, account, adapter);
  const allocation = await requestPlaytestAllocation({
    account,
    readToken,
    claim: () => adapter.claimPlaytestCredit(),
  });
  return {
    status: "confirmed",
    action: "claim",
    amount: formatTokenAmount(PLAYTEST_CREDIT_AMOUNT),
    publicTokenBalance: formatTokenAmount(allocation.balance),
    transactionHash: allocation.receipt.transactionHash,
    sponsored: true,
  };
}

async function claim(options, controls = {}) {
  if (options._.length !== 0 || Object.keys(options).some((key) => key !== "_")) {
    throw new Error("The playtest claim command does not accept options.");
  }
  const result = await withWalletLock(() => performClaim());
  if (controls.emit !== false) output(result);
  return result;
}

async function ensurePlaytestFunds() {
  return withWalletLock(async () => {
    const wallet = await checkedWallet();
    const { state, account } = wallet;
    await requireNoPending(state);
    await ensureRegistered(state, account, wallet.adapter);
    const [publicBalance, faucetUsed] = await Promise.all([
      readToken("balanceOf", [account]),
      readToken("faucetUsed", [account]),
    ]);
    const plan = playtestFundingPlan({
      hasPrivateFunds: state.notes.some((note) => note.status === "available"),
      publicBalance,
      faucetUsed,
      targetAmount: PLAYTEST_CREDIT_AMOUNT,
    });
    if (plan.action === "keep-private") {
      return { status: "existing", location: "private-pool", sponsored: true };
    }

    let allocation = null;
    if (plan.action === "claim-and-deposit") {
      allocation = await performClaim(wallet);
    }
    const deposited = await performDeposit(plan.amount, wallet);
    return {
      status: "deposited",
      amount: deposited.amount,
      claimTransaction: allocation?.transactionHash ?? null,
      depositTransaction: deposited.transactionHash,
      sponsored: true,
    };
  });
}

async function canonicalDigestFromOptions(options, allowDigest = true) {
  const sourceNames = allowDigest
    ? ["request-file", "request-digest", "request-base64"]
    : ["request-file", "request-base64"];
  const sources = sourceNames
    .filter((name) => typeof options[name] === "string" && options[name].length > 0);
  if (sources.length !== 1) {
    throw new Error(`Provide one ${sourceNames.join(" or ")} value.`);
  }
  if (options["request-file"]) {
    const value = await readFile(options["request-file"]);
    if (value.length === 0 || value.length > 64 * 1024) {
      throw new Error("The x402 request file must contain 1 to 65,536 bytes.");
    }
    return canonicalRequestDigest(value);
  }
  if (options["request-base64"]) {
    const encoded = options["request-base64"];
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
      throw new Error("The x402 request must use canonical base64.");
    }
    const value = Buffer.from(encoded, "base64");
    if (value.length === 0 || value.length > 64 * 1024) {
      throw new Error("The x402 request must contain 1 to 65,536 bytes.");
    }
    return canonicalRequestDigest(value);
  }
  const digest = parseField(required(options, "request-digest"), "The request digest").toString();
  return digest;
}

async function digestFromOptions(options) {
  return bindRequestDigest(await canonicalDigestFromOptions(options));
}

async function availableNote(state, amount, allowExact = false) {
  const candidates = state.notes
    .filter((note) => (
      note.status === "available"
      && (allowExact ? BigInt(note.amount) >= amount : BigInt(note.amount) > amount)
    ))
    .sort((left, right) => BigInt(left.amount) < BigInt(right.amount) ? -1 : 1);
  for (const note of candidates) {
    if (await readPool("commitments", [BigInt(note.commitment)])) return note;
  }
  throw new Error("No available private note can fund this action.");
}

async function pay(options) {
  if (options.privateInput !== true) {
    throw new Error("Pass private payment options through standard input with --input -.");
  }
  const merchant = getAddress(required(options, "merchant"));
  const amount = parseTokenAmount(required(options, "amount"));
  const merchantNoteKey = required(options, "merchant-note-key");
  const requestBinding = await digestFromOptions(options);
  await withWalletLock(async () => {
    const { state, account, adapter } = await checkedWallet();
    await requireNoPending(state);
    const input = await availableNote(state, amount);
    const recipientOwner = await readPool("ownerOf", [merchant]);
    if (recipientOwner === 0n) throw new Error("The merchant is not registered with the GhostClaw pool.");
    const bundle = await prove("prove-payment", {
      context: await context(),
      payer: account,
      merchant,
      recipientOwner: recipientOwner.toString(),
      requestDigest: requestBinding.digest,
      spendKey: state.spendKey,
      input: await spendInputForNote(input),
      paymentAmount: amount.toString(),
      recipientBlinding: randomField(),
      changeBlinding: randomField(),
      recipientIsLeft: Number(BigInt(randomField()) & 1n),
    });
    if (await readPool("nullifiers", [BigInt(bundle.nullifier)])) {
      throw new Error("The selected private note is already spent.");
    }
    const envelope = encryptNote(
      bundle.recipientNote,
      merchantNoteKey,
      merchant,
      bundle.paymentIntent,
    );
    state.pending = {
      kind: "payment",
      amount: amount.toString(),
      inputCommitment: input.commitment,
      merchant,
      requestBindingSalt: requestBinding.salt,
      bundle,
      envelope,
      preparedAt: new Date().toISOString(),
    };
    await saveState(state);
    const receipt = await adapter.pay(bundle, merchant);
    state.pending.transactionHash = receipt.transactionHash;
    const recovery = await finalizePending(state);
    if (!recovery?.recovered) throw new Error("The confirmed payment nullifier is unavailable.");
    output({
      status: "confirmed",
      action: "payment",
      merchant,
      paymentIntent: bundle.paymentIntent,
      transactionHash: receipt.transactionHash,
      noteEnvelope: resolve(outboxDir, `${bundle.paymentIntent}.note.json`),
      paymentResponse: resolve(outboxDir, `${bundle.paymentIntent}.payment.json`),
      sponsored: true,
    });
  });
}

async function withdraw(options) {
  const amount = parseTokenAmount(required(options, "amount"));
  await withWalletLock(async () => {
    const { state, account, adapter } = await checkedWallet();
    await requireNoPending(state);
    const recipient = getAddress(options.recipient ?? account);
    const input = await availableNote(state, amount, true);
    const bundle = await prove("prove-withdrawal", {
      context: await context(),
      payer: account,
      recipient,
      spendKey: state.spendKey,
      input: await spendInputForNote(input),
      amount: amount.toString(),
      changeBlinding: randomField(),
    });
    if (await readPool("nullifiers", [BigInt(bundle.nullifier)])) {
      throw new Error("The selected private note is already spent.");
    }
    state.pending = {
      kind: "withdrawal",
      amount: amount.toString(),
      inputCommitment: input.commitment,
      bundle,
      preparedAt: new Date().toISOString(),
    };
    await saveState(state);
    const receipt = await adapter.withdraw(bundle, recipient);
    state.pending.transactionHash = receipt.transactionHash;
    const recovery = await finalizePending(state);
    if (!recovery?.recovered) throw new Error("The confirmed withdrawal nullifier is unavailable.");
    output({
      status: "confirmed",
      action: "withdrawal",
      recipient,
      amount: formatTokenAmount(amount),
      transactionHash: receipt.transactionHash,
      sponsored: true,
    });
  });
}

async function receive(options) {
  if (options.privateInput !== true) {
    throw new Error("Pass the payment response and request through standard input with --input -.");
  }
  const path = required(options, "payment-file");
  const canonicalDigest = await canonicalDigestFromOptions(options, false);
  const confirmations = options.confirmations === undefined
    ? 1
    : Number(options.confirmations);
  await withWalletLock(async () => {
    const { state, account } = await checkedWallet();
    await requireNoPending(state);
    const payload = JSON.parse(await readFile(path, "utf8"));
    const verified = await validatePaymentResponse({
      payload,
      state,
      account,
      canonicalDigest,
      publicClient,
      readPool,
      inspectReceivedPayment,
      confirmations,
    });
    if (state.notes.some((item) => item.commitment === verified.note.commitment)) {
      throw new Error("The received note already exists in this wallet.");
    }
    addNote(state, verified.note, {
      source: "received-payment",
      paymentIntent: verified.evidence.paymentIntent,
      transactionHash: verified.evidence.transactionHash,
    });
    state.receivedSettlements ??= [];
    state.receivedSettlements.push(verified.evidence);
    await saveState(state);
    output({
      status: "verified-and-imported",
      commitment: verified.note.commitment,
      paymentIntent: verified.evidence.paymentIntent,
      transactionHash: verified.evidence.transactionHash,
      confirmations: verified.evidence.confirmations,
    });
  });
}

async function recover() {
  await withWalletLock(async () => {
    const { state } = await checkedWallet();
    if (!state.pending) {
      output({ status: "clean", pending: false });
      return;
    }
    const result = await finalizePending(state);
    output({ status: result?.recovered ? "recovered" : "waiting", ...result });
  });
}

async function status(options) {
  const { state, account } = await checkedWallet();
  const available = state.notes.filter((note) => note.status === "available");
  const privateBalance = available.reduce((total, note) => total + BigInt(note.amount), 0n);
  const publicTokenBalance = await readToken("balanceOf", [account]);
  const result = {
    status: "ready",
    network: NETWORK,
    account,
    owner: state.owner,
    noteEncryptionPublicKey: state.noteEncryptionPublicKey,
    availableNotes: available.length,
    pendingAction: state.pending?.kind ?? null,
    publicTokenBalance: formatTokenAmount(publicTokenBalance),
  };
  if (options["show-private-balance"]) {
    result.privateBalance = formatTokenAmount(privateBalance);
  }
  output(result);
}

async function fund() {
  const { state, account } = await checkedWallet();
  if (process.stderr.isTTY) {
    const qrcode = (await import("qrcode-terminal")).default;
    qrcode.generate(account, { small: true }, (code) => process.stderr.write(`${code}\n`));
  }
  output({
    status: "ready-to-fund",
    network: NETWORK,
    chainId: 84532,
    account,
    asset: "valueless test gUSD",
    token: CONTRACTS.token,
    noteOwner: state.owner,
  });
}

async function merchantCard() {
  const { state, account } = await checkedWallet();
  output({
    version: 2,
    network: NETWORK,
    merchant: account,
    owner: state.owner,
    noteEncryptionScheme: "x25519-hkdf-sha256-aes-256-gcm-v2",
    noteEncryptionPublicKey: state.noteEncryptionPublicKey,
  });
}

async function identityProof(state, account, action, nonce) {
  const bundle = await prove("prove-identity", {
    context: await context(),
    spendKey: state.spendKey,
    account,
    action: String(action),
    nonce: String(nonce),
  });
  if (bundle.owner !== state.owner) {
    throw new Error("The identity proof returned another private owner.");
  }
  return bundle;
}

async function newAccountConsent(state, owner, currentAccount, action, nonce) {
  const replacement = await createReplacementTransactionSigner(
    state,
    action === 2 ? "account-rotation" : "account-recovery",
  );
  const signer = replacement.signer;
  const deadline = BigInt(Math.floor(Date.now() / 1_000) + 3_600);
  const digest = await readPool("accountConsentDigest", [
    BigInt(owner),
    currentAccount,
    signer.address,
    BigInt(action),
    BigInt(nonce),
    deadline,
  ]);
  const signature = await signer.signMessage({ message: { raw: digest } });
  return { privateKey: replacement.privateKey, signer, account: signer.address, deadline, signature };
}

async function rotateAccount() {
  await withWalletLock(async () => {
    const { state, account, adapter } = await checkedWallet();
    await requireNoPending(state);
    const nonce = await readPool("identityNonce", [BigInt(state.owner)]);
    const consent = await newAccountConsent(state, state.owner, account, 2, nonce);
    const bundle = await identityProof(state, consent.account, 2, nonce);
    const receipt = await adapter.rotateAccount(
      bundle,
      consent.account,
      consent.deadline,
      consent.signature,
    );
    if (await readPool("accountForOwner", [BigInt(state.owner)]) !== consent.account) {
      throw new Error("The Base account rotation did not complete.");
    }
    if (consent.privateKey) state.transactionPrivateKey = consent.privateKey;
    else delete state.transactionPrivateKey;
    state.account = consent.account;
    delete state.recoveryTransactionPrivateKey;
    delete state.recoveryAccount;
    await saveState(state);
    output({
      status: "confirmed",
      action: "account-rotation",
      account: consent.account,
      transactionHash: receipt.transactionHash,
      sponsored: true,
    });
  });
}

async function requestIdentityRecovery() {
  await withWalletLock(async () => {
    const [config, state] = await Promise.all([loadConfig(), loadState()]);
    await requireNoPending(state);
    const owner = BigInt(state.owner);
    const currentAccount = await readPool("accountForOwner", [owner]);
    if (currentAccount === "0x0000000000000000000000000000000000000000") {
      throw new Error("The private owner has no registered Base account.");
    }
    const nonce = await readPool("identityNonce", [owner]);
    const consent = await newAccountConsent(state, state.owner, currentAccount, 3, nonce);
    const bundle = await identityProof(state, consent.account, 3, nonce);
    const adapter = new SponsoredTransactionAdapter(config.relayUrl, consent.signer);
    const receipt = await adapter.requestRecovery(
      bundle,
      state.owner,
      consent.account,
      consent.deadline,
      consent.signature,
    );
    const pending = await readPool("pendingRecovery", [owner]);
    if (getAddress(pending.newAccount ?? pending[1]) !== consent.account) {
      throw new Error("The delayed account recovery did not start.");
    }
    if (consent.privateKey) state.recoveryTransactionPrivateKey = consent.privateKey;
    else delete state.recoveryTransactionPrivateKey;
    state.recoveryAccount = consent.account;
    state.recoveryExecuteAfter = String(pending.executeAfter ?? pending[2]);
    await saveState(state);
    output({
      status: "waiting",
      action: "account-recovery-request",
      newAccount: consent.account,
      executeAfter: state.recoveryExecuteAfter,
      transactionHash: receipt.transactionHash,
      sponsored: true,
    });
  });
}

async function cancelIdentityRecovery() {
  await withWalletLock(async () => {
    const { state, adapter } = await checkedWallet();
    const receipt = await adapter.cancelRecovery(state.owner);
    delete state.recoveryTransactionPrivateKey;
    delete state.recoveryAccount;
    delete state.recoveryExecuteAfter;
    await saveState(state);
    output({
      status: "cancelled",
      action: "account-recovery",
      transactionHash: receipt.transactionHash,
      sponsored: true,
    });
  });
}

async function finalizeIdentityRecovery() {
  await withWalletLock(async () => {
    const [config, state] = await Promise.all([loadConfig(), loadState()]);
    if (!state.recoveryAccount) {
      throw new Error("This wallet has no pending recovery account.");
    }
    const adapter = new SponsoredTransactionAdapter(
      config.relayUrl,
      await loadRecoveryTransactionSigner(state),
    );
    const receipt = await adapter.finalizeRecovery(state.owner);
    if (await readPool("accountForOwner", [BigInt(state.owner)]) !== state.recoveryAccount) {
      throw new Error("The delayed account recovery did not complete.");
    }
    if (state.recoveryTransactionPrivateKey) {
      state.transactionPrivateKey = state.recoveryTransactionPrivateKey;
    } else {
      delete state.transactionPrivateKey;
    }
    state.account = state.recoveryAccount;
    delete state.recoveryTransactionPrivateKey;
    delete state.recoveryAccount;
    delete state.recoveryExecuteAfter;
    await saveState(state);
    output({
      status: "confirmed",
      action: "account-recovery-finalized",
      account: state.account,
      transactionHash: receipt.transactionHash,
      sponsored: true,
    });
  });
}

async function emergencyUndelegate(options) {
  if (options._.length !== 0 || Object.keys(options).some((key) => key !== "_")) {
    throw new Error("The emergency undelegation command does not accept options.");
  }
  await withWalletLock(async () => {
    const { state, adapter } = await checkedWallet();
    await requireNoPending(state);
    const result = await adapter.emergencyUndelegate();
    output({
      status: result.status,
      action: "emergency-undelegation",
      account: result.account,
      transactionHash: result.transactionHash,
      sponsored: result.sponsored,
    });
  });
}

async function backup(options) {
  const { file, passphrase } = await readPassphraseOptions(options);
  try {
    const result = await withWalletLock(() => backupWallet(file, passphrase));
    output({ status: "created", ...result });
  } finally {
    passphrase.fill(0);
  }
}

async function verifyBackup(options) {
  const { file, passphrase } = await readPassphraseOptions(options);
  try {
    output(await verifyWalletBackup(file, passphrase));
  } finally {
    passphrase.fill(0);
  }
}

async function restore(options) {
  const { file, passphrase } = await readPassphraseOptions(options);
  try {
    const result = await withWalletLock(() => restoreWallet(file, passphrase));
    output(result);
  } finally {
    passphrase.fill(0);
  }
}

async function doctor(options) {
  const result = await runDoctor({
    online: options.offline !== true,
    ...(typeof options["relay-url"] === "string" ? { relayUrl: options["relay-url"] } : {}),
  });
  output(result);
  if (result.status !== "ready") process.exitCode = 1;
}

async function connect(options) {
  if (!await stateExists()) throw new Error("Run ghostclaw setup before connecting an agent client.");
  if (options._.length !== 1) throw new Error("Use ghostclaw connect claude, codex, or auto.");
  const approved = await confirm(
    `Back up the existing configuration and connect ${options._[0]}?`,
    { yes: options.yes === true },
  );
  if (!approved) {
    output({ status: "not-written", configuration: connectionSnippet() });
    return;
  }
  output(await connectAgentClient(options._[0], { scope: options.scope }));
}

async function budget(options) {
  if (process.env.GHOSTCLAW_MCP_CHILD === "1") {
    throw new Error("Change the spending budget outside the agent connection.");
  }
  if (Object.keys(options).every((key) => key === "_")) {
    output({ policy: await getPublicPolicy(), pendingApprovals: await pendingBudgetRequests() });
    return;
  }
  output(await applyBudgetOptions(options));
}

async function approve(options) {
  if (process.env.GHOSTCLAW_MCP_CHILD === "1") {
    throw new Error("Approve a budget exception outside the agent connection.");
  }
  if (options._.length !== 1 || Object.keys(options).some((key) => key !== "_")) {
    throw new Error("Use ghostclaw approve <approval-id>.");
  }
  output(await approveBudgetRequest(options._[0]));
}

async function start(options) {
  if (options._.length !== 0) throw new Error("The guided start command does not accept positional values.");
  const progress = (message) => reportProgress(message, { enabled: options.quiet !== true });
  const result = await runGuidedStart({
    approve: () => confirm(
      "Create and register a wallet, connect detected agents, and privately deposit valueless test gUSD?",
      { yes: options.yes === true },
    ),
    progress,
    setup: () => setup({
      ...options,
      connect: typeof options.connect === "string" ? options.connect : "auto",
      yes: true,
    }, { emit: false, progress }),
    fund: ensurePlaytestFunds,
  });
  const client = connectedAgentClient(result.agentConnection);
  const shouldLaunch = result.status === "ready" && client && shouldLaunchAgentClient({
    disabled: options["no-launch"] === true,
    stdinTTY: process.stdin.isTTY === true,
    stdoutTTY: process.stdout.isTTY === true,
  });
  if (shouldLaunch) {
    result.next = `Opening ${agentClientLabel(client)}. Ask it to check the GhostClaw payment budget.`;
  }
  output(result);
  if (shouldLaunch) {
    progress(`Opening ${agentClientLabel(client)}.`);
    const launch = await launchConnectedAgent(result.agentConnection, {
      prompt: guidedDemoPrompt({ account: result.account, network: result.network }),
    });
    if (launch.status !== "opened") {
      throw new Error(launch.reason);
    }
  }
}

async function benchmark(options) {
  const iterations = options.iterations === undefined ? 3 : Number(options.iterations);
  output(await benchmarkProver(iterations));
}

function usage() {
  output({
    usage: [
      "npx ghostclaw start",
      "npx ghostclaw start --no-launch",
      "npx ghostclaw init",
      "ghostclaw doctor",
      "ghostclaw connect auto",
      "ghostclaw mcp",
      "ghostclaw budget",
      "ghostclaw approve <approval-id>",
      "ghostclaw fund",
      "ghostclaw benchmark --iterations 3",
      "ghostclaw claim",
      "ghostclaw deposit --amount 100",
      "ghostclaw pay --input -",
      "ghostclaw withdraw --amount 10",
      "ghostclaw receive --input -",
      "ghostclaw status --show-private-balance",
      "ghostclaw merchant-card",
      "ghostclaw recover",
      "ghostclaw rotate-account",
      "ghostclaw request-account-recovery",
      "ghostclaw cancel-account-recovery",
      "ghostclaw finalize-account-recovery",
      "ghostclaw revoke",
      "ghostclaw backup --file ~/.ghostclaw/backups/wallet.json --input -",
      "ghostclaw verify-backup --file ~/.ghostclaw/backups/wallet.json --input -",
      "ghostclaw restore --file wallet.json --input -",
    ],
  });
}

const [command = "help", ...rest] = process.argv.slice(2);
let options = parseOptions(rest);

if (typeof options["passphrase-file"] === "string") {
  process.env.GHOSTCLAW_PASSPHRASE_FILE = resolve(options["passphrase-file"]);
  delete options["passphrase-file"];
}

try {
  const mcpCommands = new Set(["mcp", "pay"]);
  if (process.env.GHOSTCLAW_MCP_CHILD === "1" && !mcpCommands.has(command)) {
    throw new Error("This command is available to the human CLI only.");
  }
  if (command === "pay") options = await readPrivateOptions(options);
  if (command === "receive") options = await readPrivateReceiveOptions(options);
  if (command === "start") await start(options);
  else if (command === "setup" || command === "init") await setup(options);
  else if (command === "doctor") await doctor(options);
  else if (command === "connect") await connect(options);
  else if (command === "policy" || command === "budget") await budget(options);
  else if (command === "approve") await approve(options);
  else if (command === "benchmark") await benchmark(options);
  else if (command === "mcp") await import("./mcp-server.mjs");
  else if (command === "claim") await claim(options);
  else if (command === "deposit") await deposit(options);
  else if (command === "pay") await pay(options);
  else if (command === "withdraw") await withdraw(options);
  else if (command === "receive") await receive(options);
  else if (command === "recover") await recover();
  else if (command === "status") await status(options);
  else if (command === "fund") await fund();
  else if (command === "merchant-card") await merchantCard();
  else if (command === "rotate-account") await rotateAccount();
  else if (command === "request-account-recovery") await requestIdentityRecovery();
  else if (command === "cancel-account-recovery") await cancelIdentityRecovery();
  else if (command === "finalize-account-recovery") await finalizeIdentityRecovery();
  else if (command === "emergency-undelegate" || command === "revoke") await emergencyUndelegate(options);
  else if (command === "backup") await backup(options);
  else if (command === "verify-backup") await verifyBackup(options);
  else if (command === "restore") await restore(options);
  else if (command === "help") usage();
  else throw new Error(`Unknown command: ${command}`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    error: error?.message ?? "GhostClaw command failed.",
    ...(typeof error?.code === "string" ? { code: error.code } : {}),
    ...(typeof error?.approvalId === "string" ? { approvalId: error.approvalId } : {}),
  })}\n`);
  process.exitCode = 1;
}
