import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { getAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ghostclawHome } from "./paths.mjs";

const SERVICE = "GhostClaw Confidential Payments v2";
const STATE_ACCOUNT = "v2-wallet-state-key";
const TRANSACTION_ACCOUNT = "v2-transaction-key";
const SPEND_ACCOUNT = "v2-spend-key";
const NOTE_ACCOUNT = "v2-note-encryption-key";
const AGENT_ACCOUNT = "v2-agent-policy-key";
const INFO = Buffer.from("GHOSTCLAW_NOTE_ENVELOPE_V2", "utf8");
const NOTE_PLAINTEXT_BYTES = 2_048;

function credentialStoreError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

export function normalizeCredentialStoreError(error) {
  const description = [
    error?.name,
    error?.code,
    error?.message,
    error?.cause?.message,
  ].filter(Boolean).join(" ");
  if (/IsLocked|locked object|credential store is locked/i.test(description)) {
    return credentialStoreError(
      "GHOSTCLAW_CREDENTIAL_STORE_LOCKED",
      "The operating-system credential store is locked. Sign out and sign in to unlock it.",
      error,
    );
  }
  return error;
}

export const stateDir = ghostclawHome;
export const statePath = resolve(stateDir, "wallet.enc.json");
export const transactionKeyPath = resolve(stateDir, "transaction-key.enc.json");
export const spendKeyPath = resolve(stateDir, "spend-key.enc.json");
export const noteKeyPath = resolve(stateDir, "note-key.enc.json");
export const configPath = resolve(stateDir, "relay.json");
export const outboxDir = resolve(stateDir, "outbox");
export const agentStatePath = resolve(stateDir, "agent.enc.json");
export const keyStoragePath = resolve(stateDir, "key-storage.json");
const lockPath = resolve(stateDir, "wallet.lock");
const agentLockPath = resolve(stateDir, "agent.lock");
const WALLET_SCRYPT_N = 131_072;
const WALLET_SCRYPT_R = 8;
const WALLET_SCRYPT_P = 1;

function currentUid() {
  return typeof process.getuid === "function" ? process.getuid() : null;
}

async function secureDirectory(path) {
  if (path !== stateDir && path.startsWith(`${stateDir}/`)) {
    await secureDirectory(dirname(path));
  }
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  const details = await lstat(path);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error(`The GhostClaw wallet path is not a safe directory: ${path}`);
  }
  if (currentUid() !== null && details.uid !== currentUid()) {
    throw new Error(`The GhostClaw wallet directory has another owner: ${path}`);
  }
  if ((details.mode & 0o077) !== 0) {
    throw new Error(`The GhostClaw wallet directory permissions are too broad: ${path}`);
  }
}

async function secureFile(path, optional = false) {
  let details;
  try {
    details = await lstat(path);
  } catch (error) {
    if (optional && error?.code === "ENOENT") return false;
    throw error;
  }
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error(`The GhostClaw wallet path is not a safe file: ${path}`);
  }
  if (currentUid() !== null && details.uid !== currentUid()) {
    throw new Error(`The GhostClaw wallet file has another owner: ${path}`);
  }
  if ((details.mode & 0o077) !== 0) {
    throw new Error(`The GhostClaw wallet file permissions are too broad: ${path}`);
  }
  return true;
}

async function masterKey(account, create) {
  const fromEnvironment = process.env.GHOSTCLAW_STATE_KEY?.trim();
  if (fromEnvironment) {
    if (!/^[0-9a-f]{64}$/i.test(fromEnvironment)) {
      throw new Error("GHOSTCLAW_STATE_KEY must contain 64 hexadecimal characters.");
    }
    const root = Buffer.from(fromEnvironment, "hex");
    try {
      return Buffer.from(hkdfSync(
        "sha256",
        root,
        Buffer.from("GHOSTCLAW_LOCAL_KEY_DOMAINS_V2", "utf8"),
        Buffer.from(account, "utf8"),
        32,
      ));
    } finally {
      root.fill(0);
    }
  }

  const metadata = await keyStorageMetadata(create);
  if (metadata?.mode === "passphrase" || process.env.GHOSTCLAW_PASSPHRASE_FILE?.trim()) {
    if (!metadata || metadata.mode !== "passphrase") {
      throw new Error("This wallet was not created with passphrase key storage.");
    }
    const passphrase = await readWalletPassphrase();
    const root = scryptSync(passphrase, Buffer.from(metadata.salt, "base64"), 32, {
      N: WALLET_SCRYPT_N,
      r: WALLET_SCRYPT_R,
      p: WALLET_SCRYPT_P,
      maxmem: 256 * 1024 * 1024,
    });
    try {
      return Buffer.from(hkdfSync(
        "sha256",
        root,
        Buffer.from("GHOSTCLAW_LOCAL_KEY_DOMAINS_V2", "utf8"),
        Buffer.from(account, "utf8"),
        32,
      ));
    } finally {
      passphrase.fill(0);
      root.fill(0);
    }
  }
  if (metadata && metadata.mode !== "keychain") {
    throw new Error("The GhostClaw wallet key-storage mode is unsupported.");
  }
  let AsyncEntry;
  try {
    ({ AsyncEntry } = await import("@napi-rs/keyring"));
  } catch {
    throw new Error(
      "The operating-system credential store is unavailable. Use --passphrase-file during init.",
    );
  }
  const entry = new AsyncEntry(SERVICE, account);
  let password;
  try {
    password = await entry.getPassword();
  } catch (error) {
    const normalized = normalizeCredentialStoreError(error);
    if (normalized !== error || !create) throw normalized;
  }
  if (!password && create) {
    password = randomBytes(32).toString("hex");
    await entry.setPassword(password);
  }
  if (!password || !/^[0-9a-f]{64}$/i.test(password)) {
    throw credentialStoreError(
      "GHOSTCLAW_CREDENTIAL_STORE_KEY_MISSING",
      "The GhostClaw state key is unavailable from the operating-system credential store.",
    );
  }
  return Buffer.from(password, "hex");
}

export async function keyStorageStatus(dependencies = {}) {
  const metadata = await (dependencies.metadata ?? keyStorageMetadata)(false);
  const environmentKey = Boolean(process.env.GHOSTCLAW_STATE_KEY?.trim());
  const mode = environmentKey ? "environment" : metadata?.mode ?? "unconfigured";
  if (!metadata && !environmentKey) {
    return { ready: true, mode, detail: "Key storage is not configured" };
  }
  let key;
  try {
    key = await (dependencies.getKey ?? masterKey)(STATE_ACCOUNT, false);
    return {
      ready: Buffer.isBuffer(key) && key.length === 32,
      mode,
      detail: mode === "keychain"
        ? "Operating-system credential store is unlocked"
        : mode === "passphrase"
          ? "Passphrase file is available"
          : "Environment key is available",
    };
  } catch (error) {
    const normalized = normalizeCredentialStoreError(error);
    return {
      ready: false,
      mode,
      code: normalized?.code ?? "GHOSTCLAW_KEY_STORAGE_UNAVAILABLE",
      detail: normalized?.message ?? "The wallet key storage is unavailable.",
    };
  } finally {
    key?.fill(0);
  }
}

async function keyStorageMetadata(create) {
  await secureDirectory(stateDir);
  try {
    await secureFile(keyStoragePath);
    const metadata = JSON.parse(await readFile(keyStoragePath, "utf8"));
    if (
      metadata?.version !== 1
      || !["keychain", "passphrase"].includes(metadata.mode)
      || (
        metadata.mode === "passphrase"
        && (metadata.kdf !== "scrypt" || typeof metadata.salt !== "string")
      )
    ) {
      throw new Error("The GhostClaw key-storage configuration is invalid.");
    }
    return metadata;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    if (!create) return null;
    const passphraseMode = Boolean(process.env.GHOSTCLAW_PASSPHRASE_FILE?.trim());
    const metadata = passphraseMode
      ? {
          version: 1,
          mode: "passphrase",
          kdf: "scrypt",
          N: WALLET_SCRYPT_N,
          r: WALLET_SCRYPT_R,
          p: WALLET_SCRYPT_P,
          salt: randomBytes(32).toString("base64"),
        }
      : { version: 1, mode: "keychain" };
    await atomicWrite(keyStoragePath, `${JSON.stringify(metadata, null, 2)}\n`);
    return metadata;
  }
}

async function readWalletPassphrase() {
  const configured = process.env.GHOSTCLAW_PASSPHRASE_FILE?.trim();
  if (!configured) {
    throw new Error("Set GHOSTCLAW_PASSPHRASE_FILE to unlock this passphrase wallet.");
  }
  const path = resolve(configured);
  await secureFile(path);
  const value = await readFile(path);
  let end = value.length;
  while (end > 0 && (value[end - 1] === 10 || value[end - 1] === 13)) end -= 1;
  const passphrase = Buffer.from(value.subarray(0, end));
  value.fill(0);
  if (passphrase.length < 12 || passphrase.length > 1_024) {
    passphrase.fill(0);
    throw new Error("The wallet passphrase file must contain 12 through 1,024 bytes.");
  }
  return passphrase;
}

async function atomicWrite(path, contents, mode = 0o600) {
  await secureDirectory(dirname(path));
  const temporary = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  let handle;
  try {
    handle = await open(temporary, "wx", mode);
    await handle.writeFile(contents);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, path);
    await secureFile(path);
  } finally {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
}

function sealJson(value, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  try {
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return {
      version: 1,
      algorithm: "aes-256-gcm",
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
  } finally {
    plaintext.fill(0);
  }
}

function openJson(envelope, key) {
  if (envelope?.version !== 1 || envelope?.algorithm !== "aes-256-gcm") {
    throw new Error("The wallet state format is unsupported.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  let plaintext;
  try {
    plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString("utf8"));
  } finally {
    plaintext?.fill(0);
  }
}

export async function stateExists() {
  await secureDirectory(stateDir);
  const present = await Promise.all([
    secureFile(statePath, true),
    secureFile(transactionKeyPath, true),
    secureFile(spendKeyPath, true),
    secureFile(noteKeyPath, true),
  ]);
  if (present.every(Boolean)) return true;
  if (present.some(Boolean)) {
    throw new Error("The GhostClaw wallet key store is incomplete.");
  }
  return false;
}

export async function createState(spendKey, options = {}) {
  if (await stateExists()) {
    throw new Error("The local GhostClaw wallet already exists.");
  }
  const { privateKey, publicKey } = generateKeyPairSync("x25519");
  const transactionPrivateKey = options.externalAccount ? null : generatePrivateKey();
  const account = options.externalAccount
    ? getAddress(options.externalAccount)
    : privateKeyToAccount(transactionPrivateKey).address;
  const state = {
    version: 3,
    keySet: randomBytes(16).toString("hex"),
    spendKey,
    owner: null,
    account,
    transactionSignerMode: options.externalAccount ? "external" : "local",
    ...(transactionPrivateKey ? { transactionPrivateKey } : {}),
    noteEncryptionPrivateKey: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    noteEncryptionPublicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    notes: [],
    history: [],
    receivedSettlements: [],
    createdAt: new Date().toISOString(),
  };
  await saveState(state, true);
  return state;
}

export async function loadState() {
  if (!(await stateExists())) {
    throw new Error("Run `npx ghostclaw init` before this command.");
  }
  const [metadata, transaction, spend, note] = await Promise.all([
    loadDomain(statePath, STATE_ACCOUNT),
    loadDomain(transactionKeyPath, TRANSACTION_ACCOUNT),
    loadDomain(spendKeyPath, SPEND_ACCOUNT),
    loadDomain(noteKeyPath, NOTE_ACCOUNT),
  ]);
  if (
    metadata?.version !== 3
    || !metadata.keySet
    || transaction?.keySet !== metadata.keySet
    || spend?.keySet !== metadata.keySet
    || note?.keySet !== metadata.keySet
  ) {
    throw new Error("The GhostClaw wallet key domains do not match.");
  }
  return {
    ...metadata,
    transactionSignerMode: transaction.mode ?? metadata.transactionSignerMode ?? "local",
    ...(transaction.transactionPrivateKey
      ? { transactionPrivateKey: transaction.transactionPrivateKey }
      : {}),
    ...(transaction.recoveryTransactionPrivateKey
      ? { recoveryTransactionPrivateKey: transaction.recoveryTransactionPrivateKey }
      : {}),
    spendKey: spend.spendKey,
    noteEncryptionPrivateKey: note.noteEncryptionPrivateKey,
  };
}

export function transactionAccount(state) {
  if (state?.version !== 3) {
    throw new Error(
      "This wallet predates local transaction signing. Create a new GhostClaw data directory for this release.",
    );
  }
  if (state.transactionSignerMode === "external") {
    if (!state.account) throw new Error("The external transaction signer account is missing.");
    return state.account;
  }
  if (!state.transactionPrivateKey) {
    throw new Error("The encrypted local transaction key is unavailable.");
  }
  const account = privateKeyToAccount(state.transactionPrivateKey).address;
  if (state.account && state.account.toLowerCase() !== account.toLowerCase()) {
    throw new Error("The encrypted transaction key does not match the stored account address.");
  }
  return account;
}

export async function saveState(state, createKey = false) {
  if (
    state?.version !== 3
    || !/^[0-9a-f]{32}$/i.test(String(state.keySet ?? ""))
    || (
      state.transactionSignerMode === "external"
        ? !state.account
        : !state.transactionPrivateKey
    )
    || !state.spendKey
    || !state.noteEncryptionPrivateKey
  ) {
    throw new Error("The GhostClaw v2 wallet state is incomplete.");
  }
  const {
    transactionPrivateKey,
    recoveryTransactionPrivateKey,
    spendKey,
    noteEncryptionPrivateKey,
    ...metadata
  } = state;
  if (createKey && !process.env.GHOSTCLAW_STATE_KEY?.trim()) {
    await keyStorageMetadata(true);
  }
  await Promise.all([
    saveDomain(transactionKeyPath, TRANSACTION_ACCOUNT, {
      version: 1,
      keySet: state.keySet,
      mode: state.transactionSignerMode ?? "local",
      account: state.account,
      ...(transactionPrivateKey ? { transactionPrivateKey } : {}),
      ...(recoveryTransactionPrivateKey ? { recoveryTransactionPrivateKey } : {}),
    }, createKey),
    saveDomain(spendKeyPath, SPEND_ACCOUNT, {
      version: 1, keySet: state.keySet, spendKey,
    }, createKey),
    saveDomain(noteKeyPath, NOTE_ACCOUNT, {
      version: 1, keySet: state.keySet, noteEncryptionPrivateKey,
    }, createKey),
  ]);
  await saveDomain(statePath, STATE_ACCOUNT, metadata, createKey);
}

async function loadDomain(path, account) {
  await secureFile(path);
  const envelope = JSON.parse(await readFile(path, "utf8"));
  const key = await masterKey(account, false);
  try {
    return openJson(envelope, key);
  } finally {
    key.fill(0);
  }
}

async function saveDomain(path, account, value, createKey) {
  const key = await masterKey(account, createKey);
  try {
    await atomicWrite(path, `${JSON.stringify(sealJson(value, key), null, 2)}\n`);
  } finally {
    key.fill(0);
  }
}

export async function loadConfig() {
  try {
    await secureDirectory(stateDir);
    await secureFile(configPath);
    const config = JSON.parse(await readFile(configPath, "utf8"));
    if (config?.version !== 3 || !config.relayUrl) {
      throw new Error("The relay configuration is invalid.");
    }
    return config;
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error("Run `npx ghostclaw init` first.");
    }
    throw error;
  }
}

export async function saveConfig(relayUrl) {
  const config = {
    version: 3,
    network: "base-sepolia",
    relayUrl,
    savedAt: new Date().toISOString(),
  };
  await atomicWrite(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return config;
}

export function defaultAgentState() {
  const now = new Date();
  return {
    version: 2,
    policy: {
      maxPerPayment: "10000000",
      maxPerSession: "25000000",
      maxPerDay: "50000000",
      merchantAllowlist: [],
      merchantDenylist: [],
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000).toISOString(),
    },
    usage: { sessionStartedAt: now.toISOString(), sessionTotal: "0", days: {} },
    approvals: {},
    payments: {},
  };
}

export async function loadAgentState() {
  await secureDirectory(stateDir);
  if (!await secureFile(agentStatePath, true)) return defaultAgentState();
  let value = await loadDomain(agentStatePath, AGENT_ACCOUNT);
  if (value?.version === 1 && value.policy && value.usage) {
    value = {
      version: 2,
      policy: {
        maxPerPayment: value.policy.maxPerPayment,
        maxPerSession: value.policy.maxPerSession,
        maxPerDay: value.policy.maxPerDay,
        merchantAllowlist: value.policy.merchantAllowlist ?? [],
        merchantDenylist: [],
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000).toISOString(),
      },
      usage: value.usage,
      approvals: {},
      payments: {},
    };
    await saveAgentState(value);
  }
  value.payments ??= {};
  if (value?.version !== 2 || !value.policy || !value.usage || !value.approvals || !value.payments) {
    throw new Error("The local agent policy state is invalid.");
  }
  return value;
}

export async function saveAgentState(value, createKey = false) {
  if (value?.version !== 2 || !value.policy || !value.usage || !value.approvals || !value.payments) {
    throw new Error("The local agent policy state is incomplete.");
  }
  if (createKey && !process.env.GHOSTCLAW_STATE_KEY?.trim()) {
    await keyStorageMetadata(true);
  }
  await saveDomain(agentStatePath, AGENT_ACCOUNT, value, createKey);
}

const BACKUP_SCRYPT_N = 131_072;
const BACKUP_SCRYPT_R = 8;
const BACKUP_SCRYPT_P = 1;

function backupPassphrase(value) {
  const passphrase = Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(String(value ?? ""), "utf8");
  if (passphrase.length < 12 || passphrase.length > 1_024) {
    passphrase.fill(0);
    throw new Error("The backup passphrase must contain 12 through 1,024 bytes.");
  }
  return passphrase;
}

function backupKey(passphrase, salt) {
  return scryptSync(passphrase, salt, 32, {
    N: BACKUP_SCRYPT_N,
    r: BACKUP_SCRYPT_R,
    p: BACKUP_SCRYPT_P,
    maxmem: 256 * 1024 * 1024,
  });
}

function requireBackupPath(path) {
  const resolved = resolve(path);
  const protectedPaths = new Set([
    statePath, transactionKeyPath, spendKeyPath, noteKeyPath, agentStatePath,
    keyStoragePath, configPath, lockPath, agentLockPath,
  ]);
  if (protectedPaths.has(resolved)) {
    throw new Error("The backup path conflicts with a live wallet file.");
  }
  return resolved;
}

export async function backupWallet(path, passphraseValue) {
  const destination = requireBackupPath(path);
  const [state, config, agentState] = await Promise.all([loadState(), loadConfig(), loadAgentState()]);
  const passphrase = backupPassphrase(passphraseValue);
  const salt = randomBytes(32);
  const iv = randomBytes(12);
  const key = backupKey(passphrase, salt);
  const createdAt = new Date().toISOString();
  const plaintext = Buffer.from(JSON.stringify({
    version: 1,
    protocol: "ghostclaw-confidential-payments-v2",
    state,
    config,
    agentState,
    createdAt,
  }), "utf8");
  try {
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from("GHOSTCLAW_ENCRYPTED_BACKUP_V2", "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const envelope = {
      version: 1,
      scheme: "scrypt-aes-256-gcm",
      kdf: { name: "scrypt", N: BACKUP_SCRYPT_N, r: BACKUP_SCRYPT_R, p: BACKUP_SCRYPT_P },
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
    await atomicWrite(destination, `${JSON.stringify(envelope, null, 2)}\n`);
    return { path: destination, account: state.account, createdAt };
  } finally {
    passphrase.fill(0);
    key.fill(0);
    plaintext.fill(0);
  }
}

async function openBackup(path, passphraseValue) {
  const source = requireBackupPath(path);
  await secureFile(source);
  const envelope = JSON.parse(await readFile(source, "utf8"));
  if (
    envelope?.version !== 1
    || envelope.scheme !== "scrypt-aes-256-gcm"
    || envelope.kdf?.name !== "scrypt"
    || envelope.kdf.N !== BACKUP_SCRYPT_N
    || envelope.kdf.r !== BACKUP_SCRYPT_R
    || envelope.kdf.p !== BACKUP_SCRYPT_P
  ) {
    throw new Error("The encrypted backup format is unsupported.");
  }
  const passphrase = backupPassphrase(passphraseValue);
  const key = backupKey(passphrase, Buffer.from(envelope.salt, "base64"));
  let plaintext;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
    decipher.setAAD(Buffer.from("GHOSTCLAW_ENCRYPTED_BACKUP_V2", "utf8"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]);
    const payload = JSON.parse(plaintext.toString("utf8"));
    if (
      payload?.version !== 1
      || payload.protocol !== "ghostclaw-confidential-payments-v2"
      || payload.state?.version !== 3
      || payload.config?.version !== 3
      || transactionAccount(payload.state) !== payload.state.account
    ) {
      throw new Error("The encrypted backup contents are invalid.");
    }
    return payload;
  } finally {
    passphrase.fill(0);
    key.fill(0);
    plaintext?.fill(0);
  }
}

export async function verifyWalletBackup(path, passphrase) {
  const payload = await openBackup(path, passphrase);
  return {
    status: "verified",
    account: payload.state.account,
    owner: payload.state.owner,
    createdAt: payload.createdAt,
  };
}

export async function restoreWallet(path, passphrase) {
  if (await stateExists()) {
    throw new Error("A local GhostClaw wallet already exists.");
  }
  const payload = await openBackup(path, passphrase);
  await saveState(payload.state, true);
  await saveAgentState(payload.agentState ?? defaultAgentState(), true);
  await saveConfig(payload.config.relayUrl);
  const restored = await loadState();
  if (restored.keySet !== payload.state.keySet || transactionAccount(restored) !== payload.state.account) {
    throw new Error("The restored wallet failed its local verification.");
  }
  return { status: "restored", account: restored.account, owner: restored.owner };
}

function noteKey(sharedSecret, salt) {
  if (sharedSecret.length !== 32 || sharedSecret.every((value) => value === 0)) {
    throw new Error("The note key agreement returned an invalid shared secret.");
  }
  return Buffer.from(hkdfSync("sha256", sharedSecret, salt, INFO, 32));
}

function noteAad(recipient, paymentIntent) {
  return Buffer.from(`${recipient.toLowerCase()}:${paymentIntent}`, "utf8");
}

function padNote(note) {
  const encoded = Buffer.from(JSON.stringify(note), "utf8");
  if (encoded.length > NOTE_PLAINTEXT_BYTES - 4) {
    throw new Error("The private note exceeds the fixed envelope size.");
  }
  const padded = randomBytes(NOTE_PLAINTEXT_BYTES);
  padded.writeUInt32BE(encoded.length, 0);
  encoded.copy(padded, 4);
  return padded;
}

function openPaddedNote(padded) {
  if (padded.length !== NOTE_PLAINTEXT_BYTES) {
    throw new Error("The private note envelope has an invalid plaintext size.");
  }
  const length = padded.readUInt32BE(0);
  if (length === 0 || length > NOTE_PLAINTEXT_BYTES - 4) {
    throw new Error("The private note envelope has an invalid content size.");
  }
  return JSON.parse(padded.subarray(4, 4 + length).toString("utf8"));
}

export function encryptNote(note, recipientPublicKey, recipient, paymentIntent) {
  const merchantKey = createPublicKey({
    key: Buffer.from(recipientPublicKey, "base64"),
    format: "der",
    type: "spki",
  });
  if (merchantKey.asymmetricKeyType !== "x25519") {
    throw new Error("The merchant note key must be an X25519 public key.");
  }
  const ephemeral = generateKeyPairSync("x25519");
  const salt = randomBytes(32);
  const sharedSecret = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: merchantKey });
  const key = noteKey(sharedSecret, salt);
  sharedSecret.fill(0);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(noteAad(recipient, paymentIntent));
  const padded = padNote(note);
  try {
    const ciphertext = Buffer.concat([
      cipher.update(padded),
      cipher.final(),
    ]);
    return {
      version: 2,
      scheme: "x25519-hkdf-sha256-aes-256-gcm-v2",
      recipient,
      paymentIntent,
      paddedPlaintextBytes: NOTE_PLAINTEXT_BYTES,
      ephemeralPublicKey: ephemeral.publicKey.export({ format: "der", type: "spki" }).toString("base64"),
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
  } finally {
    key.fill(0);
    padded.fill(0);
  }
}

export function decryptNote(envelope, state) {
  if (envelope?.version !== 2 || envelope?.scheme !== "x25519-hkdf-sha256-aes-256-gcm-v2") {
    throw new Error("The note envelope format is unsupported.");
  }
  if (envelope.paddedPlaintextBytes !== NOTE_PLAINTEXT_BYTES) {
    throw new Error("The note envelope padding policy is unsupported.");
  }
  const privateKey = createPrivateKey({
    key: Buffer.from(state.noteEncryptionPrivateKey, "base64"),
    format: "der",
    type: "pkcs8",
  });
  const ephemeralPublicKey = createPublicKey({
    key: Buffer.from(envelope.ephemeralPublicKey, "base64"),
    format: "der",
    type: "spki",
  });
  const sharedSecret = diffieHellman({ privateKey, publicKey: ephemeralPublicKey });
  const key = noteKey(sharedSecret, Buffer.from(envelope.salt, "base64"));
  sharedSecret.fill(0);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAAD(noteAad(envelope.recipient, envelope.paymentIntent));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  let plaintext;
  try {
    plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]);
    return openPaddedNote(plaintext);
  } finally {
    key.fill(0);
    plaintext?.fill(0);
  }
}

export async function writeEnvelope(envelope) {
  const path = resolve(outboxDir, `${envelope.paymentIntent}.note.json`);
  await atomicWrite(path, `${JSON.stringify(envelope, null, 2)}\n`);
  return path;
}

export async function writePaymentResponse(response) {
  const path = resolve(outboxDir, `${response.paymentIntent}.payment.json`);
  await atomicWrite(path, `${JSON.stringify(response, null, 2)}\n`);
  return path;
}

async function withLock(path, name, action) {
  await secureDirectory(stateDir);
  let handle;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      handle = await open(path, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`);
      await handle.sync();
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      await secureFile(path);
      let lock;
      try {
        const text = await readFile(path, "utf8");
        lock = text.trim().startsWith("{") ? JSON.parse(text) : { pid: Number(text.trim()) };
      } catch {
        throw new Error(`The GhostClaw ${name} lock is invalid. Inspect it before removal.`);
      }
      if (!Number.isSafeInteger(lock.pid) || lock.pid < 1) {
        throw new Error(`The GhostClaw ${name} lock has an invalid process identifier.`);
      }
      let active = true;
      try {
        process.kill(lock.pid, 0);
      } catch (killError) {
        if (killError?.code === "ESRCH") active = false;
        else if (killError?.code !== "EPERM") throw killError;
      }
      if (active) {
        throw new Error(`Another GhostClaw ${name} command is running.`);
      }
      await unlink(path);
      if (attempt === 1) {
        throw new Error(`The GhostClaw stale ${name} lock could not be recovered.`);
      }
    }
  }
  if (!handle) throw new Error(`The GhostClaw ${name} lock could not be created.`);
  try {
    return await action();
  } finally {
    await handle.close();
    await unlink(path).catch(() => {});
  }
}

export function withWalletLock(action) {
  return withLock(lockPath, "wallet", action);
}

export function withAgentLock(action) {
  return withLock(agentLockPath, "agent policy", action);
}
