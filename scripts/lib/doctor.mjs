import { execFile } from "node:child_process";
import { access, lstat } from "node:fs/promises";
import { promisify } from "node:util";
import { DEFAULT_RELAY_URL, normalizeRelayUrl, publicClient, verifyTrustedDelegation } from "./alchemy-adapter.mjs";
import { artifactStatus } from "./artifact-installer.mjs";
import { resolveNativeProver, verifyNativeProver } from "./native-prover.mjs";
import { CONTRACTS, CHAIN_ID } from "./protocol.mjs";
import { configPath, keyStorageStatus, statePath } from "./state.mjs";

const execFileAsync = promisify(execFile);

async function commandVersion(command, args) {
  try {
    const { stdout } = await execFileAsync(command, args, { timeout: 10_000, maxBuffer: 64 * 1024 });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function regularFile(path) {
  try {
    const details = await lstat(path);
    return details.isFile() && !details.isSymbolicLink();
  } catch {
    return false;
  }
}

export async function runDoctor(options = {}) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, status: ok ? "pass" : "fail", detail });
  const native = resolveNativeProver();
  const supportedPlatform = (
    ["darwin", "linux"].includes(process.platform) && ["arm64", "x64"].includes(process.arch)
  ) || (process.platform === "win32" && process.arch === "x64");
  add("platform", supportedPlatform, `${process.platform}/${process.arch}`);
  add("runtime", Number(process.versions.node.split(".")[0]) >= 22, `Node.js ${process.versions.node}`);
  if (native) {
    const files = [native.prover, native.limiter];
    let nativeReady = (await Promise.all(
      files.map((path) => access(path).then(() => true).catch(() => false)),
    )).every(Boolean);
    if (nativeReady) {
      try {
        await verifyNativeProver(native);
      } catch {
        nativeReady = false;
      }
    }
    add("native-prover", nativeReady, native.source);
  } else {
    const go = await commandVersion("go", ["version"]);
    add("source-prover", Boolean(go), go ?? "Go is unavailable");
  }
  const artifacts = await artifactStatus();
  add("proving-artifacts", artifacts.ready, artifacts.ready ? artifacts.source : `${artifacts.download.mebibytes} MiB required`);
  const walletExists = await regularFile(statePath);
  if (walletExists) {
    const storage = await (options.keyStorageStatus ?? keyStorageStatus)();
    add("key-storage", storage.ready, storage.detail);
  } else {
    const passphrase = Boolean(process.env.GHOSTCLAW_PASSPHRASE_FILE?.trim());
    let keychain = false;
    try {
      const loaded = await import("@napi-rs/keyring");
      keychain = typeof loaded.AsyncEntry === "function";
    } catch {
      keychain = false;
    }
    add("key-storage", passphrase || keychain, passphrase ? "Passphrase file" : "Operating-system credential store");
  }
  add("wallet", walletExists, walletExists ? "Local wallet exists" : "Run ghostclaw setup");
  add("configuration", await regularFile(configPath), await regularFile(configPath) ? "Relay configuration exists" : "Run ghostclaw setup");

  if (options.online !== false) {
    const relay = normalizeRelayUrl(options.relayUrl ?? process.env.GHOSTCLAW_RELAY_URL ?? DEFAULT_RELAY_URL);
    try {
      const healthUrl = new URL(relay);
      healthUrl.pathname = "/health";
      healthUrl.search = "";
      const response = await (options.fetchImpl ?? fetch)(healthUrl, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
      const body = await response.json();
      add("relay", response.ok && body?.status === "ready", healthUrl.origin);
    } catch {
      add("relay", false, "The relay health check failed");
    }
    try {
      const client = options.publicClient ?? publicClient;
      const [chainId, poolCode, tokenCode] = await Promise.all([
        client.getChainId(),
        client.getBytecode({ address: CONTRACTS.pool }),
        client.getBytecode({ address: CONTRACTS.token }),
      ]);
      add("base-sepolia", chainId === CHAIN_ID && Boolean(poolCode) && Boolean(tokenCode), `Chain ${chainId}`);
      await verifyTrustedDelegation(client);
      add("delegation-runtime", true, "Pinned runtime hash matched");
    } catch {
      add("base-sepolia", false, "The Base contract check failed");
      add("delegation-runtime", false, "The delegation check failed");
    }
  }
  const criticalReady = checks.every((item) => (
    item.status === "pass" || item.name === "wallet" || item.name === "configuration"
  ));
  const walletReady = checks
    .filter((item) => item.name === "wallet" || item.name === "configuration")
    .every((item) => item.status === "pass");
  return {
    status: criticalReady ? (walletReady ? "ready" : "setup-required") : "attention",
    checks,
  };
}
