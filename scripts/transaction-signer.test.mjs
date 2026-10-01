import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const ACCOUNT = "0x1111111111111111111111111111111111111111";

test("an external hardware signer controls the Base account without entering wallet state", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "ghostclaw-external-signer-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const signerPath = join(directory, "hardware-signer.mjs");
  await writeFile(signerPath, `
    export async function createGhostClawTransactionSigner(input) {
      if (input.chainId !== 84532) throw new Error("wrong chain");
      return {
        address: ${JSON.stringify(ACCOUNT)},
        async signMessage() { return "0x" + "11".repeat(65); },
        async signAuthorization() { return { r: "0x" + "11".repeat(32), s: "0x" + "22".repeat(32), yParity: 0 }; },
      };
    }
  `, { mode: 0o600 });
  await chmod(signerPath, 0o600);
  const stateModule = new URL("./lib/state.mjs", import.meta.url).href;
  const signerModule = new URL("./lib/transaction-signer.mjs", import.meta.url).href;
  const program = `
    import { createState, loadState, transactionAccount } from ${JSON.stringify(stateModule)};
    import { createInitialTransactionSigner, loadTransactionSigner } from ${JSON.stringify(signerModule)};
    const signer = await createInitialTransactionSigner();
    const created = await createState("9001", { externalAccount: signer.address });
    const loaded = await loadState();
    const reloadedSigner = await loadTransactionSigner(loaded);
    process.stdout.write(JSON.stringify({
      account: transactionAccount(created),
      loadedAccount: transactionAccount(loaded),
      signerAccount: reloadedSigner.address,
      mode: loaded.transactionSignerMode,
      privateKeyPresent: Boolean(loaded.transactionPrivateKey),
    }));
  `;
  const result = await execFileAsync(process.execPath, ["--input-type=module", "--eval", program], {
    cwd: directory,
    env: {
      ...process.env,
      GHOSTCLAW_STATE_KEY: "74".repeat(32),
      GHOSTCLAW_HOME: join(directory, ".ghostclaw"),
      GHOSTCLAW_TRANSACTION_SIGNER_MODULE: signerPath,
    },
  });
  assert.deepEqual(JSON.parse(result.stdout), {
    account: ACCOUNT,
    loadedAccount: ACCOUNT,
    signerAccount: ACCOUNT,
    mode: "external",
    privateKeyPresent: false,
  });
  const encryptedDomain = await readFile(
    join(directory, ".ghostclaw", "transaction-key.enc.json"),
    "utf8",
  );
  assert.doesNotMatch(encryptedDomain, /privateKey/i);
});
