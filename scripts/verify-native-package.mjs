#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const packageDirectory = resolve(process.argv[2] ?? "");
const platform = process.argv[3];
const arch = process.argv[4];
const supported = new Set([
  "darwin/arm64", "darwin/x64", "linux/arm64", "linux/x64", "win32/x64",
]);
const target = `${platform}/${arch}`;
if (!supported.has(target)) throw new Error(`Unsupported native package target: ${target}`);

const expectedPackage = `@ghostclaw/prover-${platform}-${arch}`;
const suffix = platform === "win32" ? ".exe" : "";
const expectedFiles = [`ghostclaw-prover${suffix}`, `ghostclaw-prover-limiter${suffix}`];
const packageJSON = JSON.parse(await readFile(resolve(packageDirectory, "package.json"), "utf8"));
if (packageJSON.name !== expectedPackage) {
  throw new Error(`Native package name mismatch: ${packageJSON.name}`);
}

const manifest = JSON.parse(await readFile(resolve(packageDirectory, "checksums.json"), "utf8"));
if (manifest.version !== 1 || manifest.package !== expectedPackage || manifest.target !== target) {
  throw new Error("Native package checksum metadata does not match the target.");
}
if (!Array.isArray(manifest.files) || manifest.files.length !== expectedFiles.length) {
  throw new Error("Native package checksum metadata has an invalid file list.");
}

for (const file of expectedFiles) {
  const record = manifest.files.find((candidate) => candidate.file === file);
  if (!record) throw new Error(`Native package checksum is missing ${file}.`);
  const path = resolve(packageDirectory, "bin", file);
  const details = await lstat(path);
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error(`Native package file is not a regular file: ${file}`);
  }
  if (platform !== "win32" && (details.mode & 0o111) === 0) {
    throw new Error(`Native package file is not executable: ${file}`);
  }
  const contents = await readFile(path);
  const digest = createHash("sha256").update(contents).digest("hex");
  if (record.bytes !== contents.length || record.sha256 !== digest) {
    throw new Error(`Native package checksum does not match ${file}.`);
  }
  const run = spawnSync(path, [], { encoding: "utf8", timeout: 5_000, windowsHide: true });
  const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
  if (run.status !== 1 || !output.includes(`usage: ${file.replace(suffix, "")}`)) {
    throw new Error(`Native package executable did not return its usage guard: ${file}`);
  }
}

process.stdout.write(`Verified ${expectedPackage} for ${target}.\n`);
