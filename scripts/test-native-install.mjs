#!/usr/bin/env node

import { execFile } from "node:child_process";
import { chmod, lstat, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { commandInvocation } from "./lib/command-invocation.mjs";

const execFileAsync = promisify(execFile);
const platform = process.argv[2];
const arch = process.argv[3];
const groupWrite = process.argv.includes("--group-write");
const supported = new Set([
  "darwin/arm64", "darwin/x64", "linux/arm64", "linux/x64", "win32/x64",
]);
const target = `${platform}/${arch}`;
if (!supported.has(target)) throw new Error(`Unsupported native package target: ${target}`);
if (process.platform !== platform || process.arch !== arch) {
  throw new Error(`The install test must run on ${target}; this runner is ${process.platform}/${process.arch}.`);
}

const project = resolve(import.meta.dirname, "..");
const scratch = await mkdtemp(join(tmpdir(), `ghostclaw-${platform}-${arch}-`));
const archives = join(scratch, "archives");
const app = join(scratch, "app");
const cache = join(scratch, "cache");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

async function run(command, args, options = {}) {
  const invocation = commandInvocation(command, args);
  return execFileAsync(invocation.command, invocation.args, {
    cwd: options.cwd ?? project,
    env: process.env,
    timeout: options.timeout ?? 300_000,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
}

function archiveName(stdout) {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) throw new Error("npm pack did not return an archive name.");
  return basename(lines.at(-1));
}

try {
  await Promise.all([mkdir(archives), mkdir(app), mkdir(cache)]);
  const rootPack = await run(npm, ["pack", project, "--pack-destination", archives, "--cache", cache]);
  const nativeDirectory = resolve(project, "packages", `prover-${platform}-${arch}`);
  const nativePack = await run(npm, ["pack", nativeDirectory, "--pack-destination", archives, "--cache", cache]);
  const rootArchive = resolve(archives, archiveName(rootPack.stdout));
  const nativeArchive = resolve(archives, archiveName(nativePack.stdout));

  await writeFile(resolve(app, "package.json"), '{"name":"ghostclaw-install-test","private":true,"version":"1.0.0"}\n');
  await run(npm, [
    // The target archive is installed directly. Skip registry copies of the other
    // platform packages because they do not exist until this release publishes.
    "install", "--ignore-scripts", "--omit=optional", "--no-audit", "--no-fund", "--cache", cache,
    rootArchive, nativeArchive,
  ], {
    cwd: app,
    // A fresh Windows npm install can exceed five minutes while Defender scans
    // the dependency tree. Keep the limit bounded without killing a valid run.
    timeout: process.platform === "win32" ? 900_000 : 300_000,
  });

  const cli = resolve(app, "node_modules", ".bin", process.platform === "win32" ? "ghostclaw.cmd" : "ghostclaw");
  const help = await run(cli, ["help"], { cwd: app, timeout: 30_000 });
  if (!help.stdout.includes("npx ghostclaw init")) {
    throw new Error("The installed GhostClaw CLI did not return help.");
  }

  const installedNative = resolve(app, "node_modules", "@ghostclaw", `prover-${platform}-${arch}`);
  if (groupWrite) {
    if (platform !== "linux") throw new Error("The group-write install test requires Linux.");
    await Promise.all([
      chmod(resolve(installedNative, "checksums.json"), 0o664),
      chmod(resolve(installedNative, "bin", "ghostclaw-prover"), 0o775),
      chmod(resolve(installedNative, "bin", "ghostclaw-prover-limiter"), 0o775),
    ]);
  }
  await run(process.execPath, [resolve(project, "scripts", "verify-native-package.mjs"), installedNative, platform, arch], {
    cwd: app,
    timeout: 30_000,
  });
  const installedRuntimeModule = pathToFileURL(resolve(
    app,
    "node_modules",
    "ghostclaw",
    "scripts",
    "lib",
    "native-prover.mjs",
  )).href;
  const verifyProgram = `
    import { resolveNativeProver, verifyNativeProver } from ${JSON.stringify(installedRuntimeModule)};
    const runtime = resolveNativeProver();
    if (!runtime) throw new Error("The installed native runtime is unavailable.");
    await verifyNativeProver(runtime);
    process.stdout.write(runtime.source);
  `;
  const verified = await run(process.execPath, ["--input-type=module", "--eval", verifyProgram], {
    cwd: app,
    timeout: 30_000,
  });
  if (!verified.stdout.includes(`@ghostclaw/prover-${platform}-${arch}`)) {
    throw new Error("The installed GhostClaw runtime did not select the expected native package.");
  }
  if (groupWrite) {
    for (const path of [
      resolve(installedNative, "checksums.json"),
      resolve(installedNative, "bin", "ghostclaw-prover"),
      resolve(installedNative, "bin", "ghostclaw-prover-limiter"),
    ]) {
      if (((await lstat(path)).mode & 0o020) !== 0) {
        throw new Error("GhostClaw did not normalize the safe private-group package permission.");
      }
    }
  }
  process.stdout.write(`Clean package runtime passed on ${target}${groupWrite ? " with private-group write mode" : ""}.\n`);
} finally {
  // Windows can retain short-lived handles after npm exits. Node retries only
  // when maxRetries is set for recursive removal.
  await rm(scratch, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
}
