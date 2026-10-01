import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, readFile, stat, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { installArtifacts } from "./artifact-installer.mjs";
import {
  fileOwnerTrust,
  normalizePrivateGroupWrite,
  writableByAnotherUser,
} from "./file-security.mjs";
import { resolveNativeProver, verifyNativeProver } from "./native-prover.mjs";
import { ghostclawHome, runtimeBinDir, runtimeCacheDir } from "./paths.mjs";

const execFileAsync = promisify(execFile);
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sourceArtifacts = resolve(sourceRoot, "artifacts");
const sourceSrs = resolve(sourceRoot, "public-parameters", "bn254_g1.dat");
const binDir = runtimeBinDir;
const sourceBinary = resolve(binDir, "ghostclaw-prover");
const sourceLimiterBinary = resolve(binDir, "ghostclaw-prover-limiter");
const goCache = resolve(runtimeCacheDir, "go-build");
const PROVER_TIMEOUT_MS = 120_000;
export const PROVER_MEMORY_LIMIT_BYTES = 8 * 1024 * 1024 * 1024;
export const PROVER_GO_MEMORY_LIMIT = "6GiB";
const IGNITION_SHA256 = "3718ffbed583d8a279ccb2545196d5618e3fd97512b65aa051d2ebd0f57fb999";
const ARTIFACT_SHA256 = Object.freeze({
  "identity.ccs": "ff9f1c503931e2452bf331775671bdec80e0c52c77f99d78056c1168ee3e7f4f",
  "identity.pk": "74881510e7f2feb340c463f5af5f87f7967f5643aadfc10722b061ec991076e7",
  "identity.vk": "cc1124fa97623364e8034dddbad4ecf9d3b25f304a4e8563084b4e5f7af563df",
  "deposit.ccs": "8bfc3034cd803f1cd2c2ef9731ee8e98258cd112b01d248e7d189ac0a9d8f7f0",
  "deposit.pk": "b1aff1877634daa601b596f93cdb0f6c6e72992084a0f6bcdc3a94924e6b9fab",
  "deposit.vk": "e48bbd5a698727de55c562280822e1c2b063673b0087f4832ce21fbde76b58e4",
  "spend.ccs": "ce1f38e6cf79bbc10de1defc30ac44e5d529becc04218309ecc9b24e9e45cf13",
  "spend.pk": "4d8094cbf560ec32da91e1375e1861545b9f682e18de5bb69333b2593c8edb92",
  "spend.vk": "8cc213a6444c52c281fd543f4929376bbc2664b9891b37a61317ed9c5308647a",
  "withdraw.ccs": "79a30f0fb6b704cccc310b424561dd3ee41da8f480e20b8ee4ad4cb442dfa7dc",
  "withdraw.pk": "07c7736a202141e183703a507bea2d65f0c5ffc9c5eee5fc250fa27b0f142c35",
  "withdraw.vk": "384b7e00f1f4eef9e7412f7395082dc2bfd01ccd09635d8e0bfb415b49db99ed",
});
let preparedRuntime = null;
let preparedNativeRuntime = null;

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function requireRegularFile(path) {
  let details = await lstat(path);
  if (!details.isFile() || details.isSymbolicLink()) {
    const error = new Error(`The local prover file is unsafe: ${path}`);
    error.fileSafetyReason = "type";
    throw error;
  }
  const owner = await fileOwnerTrust(path, details);
  if (!owner.trusted) {
    const error = new Error(`The local prover file has another owner: ${path}`);
    error.fileSafetyReason = "owner";
    error.ownerTrustReason = owner.reason;
    throw error;
  }
  details = await normalizePrivateGroupWrite(path, details);
  if (await writableByAnotherUser(path, details)) {
    const error = new Error(`The local prover file is writable by another user: ${path}`);
    error.fileSafetyReason = "permissions";
    throw error;
  }
}

export async function verifyArtifactSet(directory) {
  if (!directory) throw new Error("The proving-artifact directory is required.");
  const manifestPath = resolve(directory, "manifest.json");
  await requireRegularFile(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (
    manifest.backend !== "gnark PLONK KZG"
    || manifest.curve !== "BN254"
    || manifest.gnark !== "v0.15.0"
    || manifest.ignition?.sha256 !== IGNITION_SHA256
    || manifest.generatedAt !== "1970-01-01T00:00:00Z"
    || manifest.circuits?.identity?.constraints !== 2_392
    || manifest.circuits?.deposit?.constraints !== 2_787
    || manifest.circuits?.spend?.constraints !== 17_145
    || manifest.circuits?.withdraw?.constraints !== 13_776
    || manifest.circuits?.withdraw?.publicInputs !== 7
  ) {
    throw new Error("The local proving manifest does not match this GhostClaw release.");
  }
  for (const [name, digest] of Object.entries(ARTIFACT_SHA256)) {
    const path = resolve(directory, name);
    await requireRegularFile(path);
    if (await sha256(path) !== digest) {
      throw new Error(`The local proving artifact failed its SHA-256 check: ${name}`);
    }
  }
}

async function prepareNativeRuntime() {
  if (preparedNativeRuntime) return preparedNativeRuntime;
  let native;
  try {
    native = resolveNativeProver();
  } catch (error) {
    if (error && typeof error === "object" && !error.ghostclawStage) {
      error.ghostclawStage = "merchant-native-resolve";
    }
    throw error;
  }
  const developmentSource = await exists(resolve(sourceRoot, "go.mod"));
  if (!native) {
    if (!developmentSource) {
      throw new Error(
        `The optional native prover package for ${process.platform}/${process.arch} is unavailable.`,
      );
    }
    try {
      await mkdir(binDir, { recursive: true, mode: 0o700 });
      await mkdir(goCache, { recursive: true, mode: 0o700 });
      await Promise.all([chmod(binDir, 0o700), chmod(goCache, 0o700)]);
      await execFileAsync("go", ["build", "-trimpath", "-o", sourceBinary, "./cmd/ghostclaw-prover"], {
        env: { ...process.env, GOCACHE: goCache, GOMEMLIMIT: PROVER_GO_MEMORY_LIMIT },
        maxBuffer: 2 * 1024 * 1024,
        timeout: PROVER_TIMEOUT_MS,
        killSignal: "SIGKILL",
      });
      await execFileAsync("go", ["build", "-trimpath", "-o", sourceLimiterBinary, "./cmd/ghostclaw-prover-limiter"], {
        env: { ...process.env, GOCACHE: goCache },
        maxBuffer: 2 * 1024 * 1024,
        timeout: PROVER_TIMEOUT_MS,
        killSignal: "SIGKILL",
      });
    } catch (error) {
      if (error && typeof error === "object" && !error.ghostclawStage) {
        error.ghostclawStage = "merchant-native-build";
      }
      throw error;
    }
    native = { prover: sourceBinary, limiter: sourceLimiterBinary, source: "development-source" };
  }
  try {
    await requireRegularFile(native.prover);
    await requireRegularFile(native.limiter);
  } catch (error) {
    if (error && typeof error === "object" && !error.ghostclawStage) {
      const reason = ["type", "owner", "permissions"].includes(error.fileSafetyReason)
        ? error.fileSafetyReason
        : "safety";
      const ownerReason = reason === "owner" && /^[a-z-]{1,40}$/.test(String(error.ownerTrustReason ?? ""))
        ? `-${error.ownerTrustReason}`
        : "";
      error.ghostclawStage = `merchant-native-file-${reason}${ownerReason}`;
    }
    throw error;
  }
  try {
    await verifyNativeProver(native);
  } catch (error) {
    if (error && typeof error === "object" && !error.ghostclawStage) {
      error.ghostclawStage = "merchant-native-checksum";
    }
    throw error;
  }
  preparedNativeRuntime = {
    binary: native.prover,
    limiterBinary: native.limiter,
    nativeSource: native.source,
  };
  return preparedNativeRuntime;
}

export async function prepareProver() {
  if (preparedRuntime) return preparedRuntime;
  const native = await prepareNativeRuntime();
  const developmentSource = await exists(resolve(sourceRoot, "go.mod"));

  let installed;
  if (!process.env.GHOSTCLAW_ARTIFACT_DIR && developmentSource && await exists(sourceSrs)) {
    await verifyArtifactSet(sourceArtifacts);
    if (await sha256(sourceSrs) !== IGNITION_SHA256) {
      throw new Error("The source Aztec Ignition SRS prefix failed its SHA-256 check.");
    }
    installed = { directory: sourceArtifacts, source: "development-source", downloaded: false };
  } else {
    installed = await installArtifacts();
    await verifyArtifactSet(installed.directory);
  }
  preparedRuntime = {
    ...native,
    artifactDir: installed.directory,
    artifactSource: installed.source,
  };
  return preparedRuntime;
}

export async function prove(command, request) {
  const runtime = await prepareProver();
  return spawnJson(runtime, [
    command,
    "--artifacts",
    runtime.artifactDir,
    "--input",
    "-",
    "--out",
    "-",
  ], request);
}

export async function deriveOwner(context, spendKey) {
  const runtime = await prepareProver();
  return (await spawnJson(runtime, ["owner", "--input", "-", "--out", "-"], {
    context,
    spendKey,
  })).owner;
}

export async function treeWitness(leaves, leafIndex) {
  const runtime = await prepareProver();
  return spawnJson(runtime, ["tree-witness", "--input", "-", "--out", "-"], {
    leaves,
    leafIndex,
  });
}

export async function inspectReceivedPayment(request, dependencies = {}) {
  let runtime;
  try {
    runtime = await (dependencies.prepareNativeRuntime ?? prepareNativeRuntime)();
  } catch (error) {
    if (error && typeof error === "object" && !error.ghostclawStage) {
      error.ghostclawStage = "merchant-native-runtime";
    }
    throw error;
  }
  const run = dependencies.spawnJson ?? spawnJson;
  try {
    return await run(runtime, ["inspect-received-payment", "--input", "-", "--out", "-"], request);
  } catch (error) {
    if (error && typeof error === "object" && !error.ghostclawStage) {
      error.ghostclawStage = "merchant-note-inspector";
    }
    throw error;
  }
}

export async function benchmarkProver(iterations = 3) {
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 20) {
    throw new Error("The benchmark iteration count must be 1 through 20.");
  }
  const runtime = await prepareProver();
  const outputPath = resolve(ghostclawHome, `benchmark-${process.pid}.json`);
  try {
    await execFileAsync(runtime.limiterBinary, [String(PROVER_MEMORY_LIMIT_BYTES), runtime.binary,
      "benchmark",
      "--artifacts", runtime.artifactDir,
      "--iterations", String(iterations),
      "--out", outputPath,
    ], {
      env: { ...process.env, GOCACHE: goCache, GOMEMLIMIT: PROVER_GO_MEMORY_LIMIT },
      maxBuffer: 2 * 1024 * 1024,
      timeout: PROVER_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
    return JSON.parse(await readFile(outputPath, "utf8"));
  } finally {
    await unlink(outputPath).catch(() => {});
  }
}

function spawnJson(runtime, args, request) {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    const child = spawn(runtime.limiterBinary, [String(PROVER_MEMORY_LIMIT_BYTES), runtime.binary, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, GOCACHE: goCache, GOMEMLIMIT: PROVER_GO_MEMORY_LIMIT },
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      if (settled) return;
      killLimitedProcess(child);
      settled = true;
      reject(new Error("The local prover exceeded its execution time limit."));
    }, PROVER_TIMEOUT_MS);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > 2 * 1024 * 1024) killLimitedProcess(child);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stderr.length > 128 * 1024) killLimitedProcess(child);
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error("The local prover rejected the private witness."));
        return;
      }
      try {
        const jsonStart = stdout.indexOf("{\n");
        if (jsonStart < 0) throw new Error("missing JSON result");
        resolvePromise(JSON.parse(stdout.slice(jsonStart)));
      } catch {
        reject(new Error("The local prover returned invalid JSON."));
      }
    });
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

function killLimitedProcess(child) {
  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, "SIGKILL");
      return;
    } catch {
      // The process can exit between the output check and this signal.
    }
  }
  child.kill("SIGKILL");
}
