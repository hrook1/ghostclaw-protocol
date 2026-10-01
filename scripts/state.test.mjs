import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  keyStorageStatus,
  normalizeCredentialStoreError,
} from "./lib/state.mjs";

const execFileAsync = promisify(execFile);
const SPEND_KEY = "987654321012345678909876543210123456789";

test("a locked credential store returns one actionable failure", async () => {
  const locked = new Error(
    "org.freedesktop.Secret.Error.IsLocked: Cannot get secret of a locked object",
  );
  const normalized = normalizeCredentialStoreError(locked);
  assert.equal(normalized.code, "GHOSTCLAW_CREDENTIAL_STORE_LOCKED");
  assert.match(normalized.message, /Sign out and sign in/);

  const status = await keyStorageStatus({
    metadata: async () => ({ version: 1, mode: "keychain" }),
    getKey: async () => { throw locked; },
  });
  assert.deepEqual(status, {
    ready: false,
    mode: "keychain",
    code: "GHOSTCLAW_CREDENTIAL_STORE_LOCKED",
    detail: "The operating-system credential store is locked. Sign out and sign in to unlock it.",
  });
});

test("setup generates and encrypts a local Base transaction key", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "ghostclaw-wallet-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const stateModule = new URL("./lib/state.mjs", import.meta.url).href;
  const program = `
    import { createState, loadState, transactionAccount } from ${JSON.stringify(stateModule)};
    const created = await createState(${JSON.stringify(SPEND_KEY)});
    const loaded = await loadState();
    process.stdout.write(JSON.stringify({
      version: loaded.version,
      sameAccount: transactionAccount(created) === transactionAccount(loaded),
      transactionKeyPresent: /^0x[0-9a-f]{64}$/i.test(loaded.transactionPrivateKey),
    }));
  `;
  const result = await execFileAsync(process.execPath, ["--input-type=module", "--eval", program], {
    cwd: directory,
    env: {
      ...process.env,
      GHOSTCLAW_STATE_KEY: "72".repeat(32),
      GHOSTCLAW_HOME: join(directory, ".ghostclaw"),
    },
  });
  assert.deepEqual(JSON.parse(result.stdout), {
    version: 3,
    sameAccount: true,
    transactionKeyPresent: true,
  });

  const encrypted = await readFile(join(directory, ".ghostclaw", "wallet.enc.json"), "utf8");
  assert.doesNotMatch(encrypted, new RegExp(SPEND_KEY));
  assert.doesNotMatch(encrypted, /transactionPrivateKey/);
  const transactionKey = await readFile(
    join(directory, ".ghostclaw", "transaction-key.enc.json"),
    "utf8",
  );
  const spendKey = await readFile(join(directory, ".ghostclaw", "spend-key.enc.json"), "utf8");
  assert.doesNotMatch(transactionKey, /transactionPrivateKey/);
  assert.doesNotMatch(spendKey, new RegExp(SPEND_KEY));
});

test("a stale wallet lock is recovered with its recorded process identifier", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "ghostclaw-lock-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const stateModule = new URL("./lib/state.mjs", import.meta.url).href;
  const program = `
    import { mkdir, writeFile } from "node:fs/promises";
    import { join } from "node:path";
    import { withWalletLock } from ${JSON.stringify(stateModule)};
    const stateDir = join(process.cwd(), ".ghostclaw");
    await mkdir(stateDir, { mode: 0o700 });
    await writeFile(join(stateDir, "wallet.lock"), JSON.stringify({ pid: 2147483647 }) + "\\n", { mode: 0o600 });
    const result = await withWalletLock(async () => "recovered");
    process.stdout.write(result);
  `;
  const result = await execFileAsync(process.execPath, ["--input-type=module", "--eval", program], {
    cwd: directory,
    env: { ...process.env, GHOSTCLAW_HOME: join(directory, ".ghostclaw") },
  });
  assert.equal(result.stdout, "recovered");
});

test("an encrypted backup restores and verifies all key domains on a clean state", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "ghostclaw-backup-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const stateModule = new URL("./lib/state.mjs", import.meta.url).href;
  const program = `
    import { rename, readFile } from "node:fs/promises";
    import { join } from "node:path";
    import {
      backupWallet,
      createState,
      loadState,
      restoreWallet,
      saveConfig,
      transactionAccount,
      verifyWalletBackup,
    } from ${JSON.stringify(stateModule)};
    const passphrase = Buffer.from("correct horse battery staple", "utf8");
    const created = await createState(${JSON.stringify(SPEND_KEY)});
    await saveConfig("https://relay.ghostclaw.test/rpc");
    const backupPath = join(process.cwd(), "wallet-backup.json");
    await backupWallet(backupPath, passphrase);
    const verified = await verifyWalletBackup(backupPath, passphrase);
    await rename(join(process.cwd(), ".ghostclaw"), join(process.cwd(), ".ghostclaw-old"));
    const restored = await restoreWallet(backupPath, passphrase);
    const loaded = await loadState();
    process.stdout.write(JSON.stringify({
      verifiedAccount: verified.account,
      restoredAccount: restored.account,
      loadedAccount: transactionAccount(loaded),
      spendKey: loaded.spendKey,
      encrypted: !(await readFile(backupPath, "utf8")).includes(${JSON.stringify(SPEND_KEY)}),
    }));
    passphrase.fill(0);
  `;
  const result = await execFileAsync(process.execPath, ["--input-type=module", "--eval", program], {
    cwd: directory,
    env: {
      ...process.env,
      GHOSTCLAW_STATE_KEY: "73".repeat(32),
      GHOSTCLAW_HOME: join(directory, ".ghostclaw"),
    },
    timeout: 30_000,
  });
  const restored = JSON.parse(result.stdout);
  assert.equal(restored.verifiedAccount, restored.restoredAccount);
  assert.equal(restored.loadedAccount, restored.restoredAccount);
  assert.equal(restored.spendKey, SPEND_KEY);
  assert.equal(restored.encrypted, true);
});

test("a passphrase file protects a wallet without an operating-system keychain", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "ghostclaw-passphrase-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const passphrasePath = join(directory, "wallet-passphrase");
  await writeFile(passphrasePath, "a long test wallet passphrase\n", { mode: 0o600 });
  await chmod(passphrasePath, 0o600);
  const stateModule = new URL("./lib/state.mjs", import.meta.url).href;
  const program = `
    import { createState, loadState, transactionAccount } from ${JSON.stringify(stateModule)};
    const created = await createState(${JSON.stringify(SPEND_KEY)});
    const loaded = await loadState();
    process.stdout.write(JSON.stringify({
      account: transactionAccount(loaded),
      same: transactionAccount(created) === transactionAccount(loaded),
    }));
  `;
  const result = await execFileAsync(process.execPath, ["--input-type=module", "--eval", program], {
    cwd: directory,
    env: {
      ...process.env,
      GHOSTCLAW_HOME: join(directory, ".ghostclaw"),
      GHOSTCLAW_PASSPHRASE_FILE: passphrasePath,
      GHOSTCLAW_STATE_KEY: "",
    },
    timeout: 30_000,
  });
  assert.equal(JSON.parse(result.stdout).same, true);
  const keyStorage = JSON.parse(await readFile(join(directory, ".ghostclaw", "key-storage.json"), "utf8"));
  assert.equal(keyStorage.mode, "passphrase");
  const encrypted = await readFile(join(directory, ".ghostclaw", "spend-key.enc.json"), "utf8");
  assert.doesNotMatch(encrypted, new RegExp(SPEND_KEY));
});
