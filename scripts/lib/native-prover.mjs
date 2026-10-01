import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import {
  normalizePrivateGroupWrite,
  ownedByCurrentUserOrTrustedRuntime,
  writableByAnotherUser,
} from "./file-security.mjs";

const require = createRequire(import.meta.url);

const TARGETS = new Map([
  ["darwin/arm64", "@ghostclaw/prover-darwin-arm64"],
  ["darwin/x64", "@ghostclaw/prover-darwin-x64"],
  ["linux/arm64", "@ghostclaw/prover-linux-arm64"],
  ["linux/x64", "@ghostclaw/prover-linux-x64"],
  ["win32/x64", "@ghostclaw/prover-win32-x64"],
]);

export function nativeProverPackage(platform = process.platform, arch = process.arch) {
  return TARGETS.get(`${platform}/${arch}`) ?? null;
}

export function resolveNativeProver() {
  const configuredProver = process.env.GHOSTCLAW_BUNDLED_PROVER?.trim();
  const configuredLimiter = process.env.GHOSTCLAW_BUNDLED_LIMITER?.trim();
  if (configuredProver || configuredLimiter) {
    if (!configuredProver || !configuredLimiter) {
      throw new Error("Set both GHOSTCLAW_BUNDLED_PROVER and GHOSTCLAW_BUNDLED_LIMITER.");
    }
    return {
      prover: resolve(configuredProver),
      limiter: resolve(configuredLimiter),
      source: "environment",
    };
  }
  const packageName = nativeProverPackage();
  if (!packageName) {
    throw new Error(`GhostClaw has no prover package for ${process.platform}/${process.arch}.`);
  }
  try {
    const packagePath = require.resolve(`${packageName}/package.json`);
    const root = dirname(packagePath);
    const suffix = process.platform === "win32" ? ".exe" : "";
    return {
      prover: resolve(root, "bin", `ghostclaw-prover${suffix}`),
      limiter: resolve(root, "bin", `ghostclaw-prover-limiter${suffix}`),
      checksums: resolve(root, "checksums.json"),
      source: packageName,
    };
  } catch (error) {
    if (error?.code === "MODULE_NOT_FOUND") return null;
    throw error;
  }
}

async function safeFile(path) {
  let details = await lstat(path);
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error(`The native prover package contains an unsafe file: ${path}`);
  }
  if (!await ownedByCurrentUserOrTrustedRuntime(path, details)) {
    throw new Error(`The native prover package file has another owner: ${path}`);
  }
  details = await normalizePrivateGroupWrite(path, details);
  if (await writableByAnotherUser(path, details)) {
    throw new Error(`The native prover package file is writable by another user: ${path}`);
  }
  return details;
}

export async function verifyNativeProver(runtime, platform = process.platform, arch = process.arch) {
  if (!runtime?.checksums) return runtime;
  const expectedPackage = nativeProverPackage(platform, arch);
  const checksumDetails = await safeFile(runtime.checksums);
  if (checksumDetails.size > 16 * 1024) {
    throw new Error("The native prover checksum manifest is too large.");
  }
  const manifest = JSON.parse(await readFile(runtime.checksums, "utf8"));
  const expected = new Map((manifest.files ?? []).map((item) => [item.file, item]));
  if (
    manifest.version !== 1
    || manifest.package !== expectedPackage
    || manifest.target !== `${platform}/${arch}`
    || expected.size !== 2
  ) {
    throw new Error("The native prover checksum manifest does not match this platform.");
  }
  for (const path of [runtime.prover, runtime.limiter]) {
    const details = await safeFile(path);
    const name = path.split(/[\\/]/).at(-1);
    const record = expected.get(name);
    const contents = await readFile(path);
    const digest = createHash("sha256").update(contents).digest("hex");
    contents.fill(0);
    if (
      !record
      || record.bytes !== details.size
      || !/^[0-9a-f]{64}$/.test(String(record.sha256 ?? ""))
      || record.sha256 !== digest
    ) {
      throw new Error(`The native prover package failed verification: ${name}`);
    }
  }
  return runtime;
}
