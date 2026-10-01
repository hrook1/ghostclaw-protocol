#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const supported = new Set([
  "darwin/arm64", "darwin/x64", "linux/arm64", "linux/x64", "win32/x64",
]);
const platform = process.argv[2] ?? process.platform;
const arch = process.argv[3] ?? process.arch;
const target = `${platform}/${arch}`;
if (!supported.has(target)) throw new Error(`Unsupported native package target: ${target}`);

const goos = platform === "win32" ? "windows" : platform;
const suffix = platform === "win32" ? ".exe" : "";
const packageName = `prover-${platform}-${arch}`;
const output = resolve("packages", packageName, "bin");
await mkdir(output, { recursive: true, mode: 0o755 });

const crossDarwin = platform === "darwin" && (process.platform !== "darwin" || process.arch !== arch);
if (crossDarwin) {
  throw new Error("Build each macOS limiter on a matching signed macOS runner because it uses libproc.");
}

const environment = {
  ...process.env,
  GOOS: goos,
  GOARCH: arch === "x64" ? "amd64" : arch,
  CGO_ENABLED: platform === "darwin" ? "1" : "0",
};
const prover = resolve(output, `ghostclaw-prover${suffix}`);
const limiter = resolve(output, `ghostclaw-prover-limiter${suffix}`);
const buildFlags = ["build", "-buildvcs=false", "-mod=readonly", "-trimpath", "-ldflags=-s -w -buildid="];
await execFileAsync("go", [...buildFlags, "-o", prover, "./cmd/ghostclaw-prover"], {
  env: environment, timeout: 180_000, maxBuffer: 2 * 1024 * 1024,
});
await execFileAsync("go", [...buildFlags, "-o", limiter, "./cmd/ghostclaw-prover-limiter"], {
  env: environment, timeout: 180_000, maxBuffer: 2 * 1024 * 1024,
});
if (platform !== "win32") await Promise.all([chmod(prover, 0o755), chmod(limiter, 0o755)]);

async function record(path) {
  const contents = await readFile(path);
  return { file: basename(path), bytes: contents.length, sha256: createHash("sha256").update(contents).digest("hex") };
}
const manifest = {
  version: 1,
  package: `@ghostclaw/${packageName}`,
  target,
  files: [await record(prover), await record(limiter)],
};
await writeFile(resolve(output, "..", "checksums.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
