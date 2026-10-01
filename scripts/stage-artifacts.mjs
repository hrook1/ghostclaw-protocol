#!/usr/bin/env node

import { chmod, copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { ARTIFACT_RELEASE, PINNED_ARTIFACTS } from "./lib/artifact-manifest.mjs";
import { verifyPinnedArtifacts } from "./lib/artifact-installer.mjs";

const output = resolve(process.argv[2] ?? "release/artifacts");
const verification = resolve(output, ".verification");
await mkdir(output, { recursive: true, mode: 0o755 });
await mkdir(verification, { recursive: true, mode: 0o700 });

for (const artifact of PINNED_ARTIFACTS) {
  const source = resolve("public", "proving", ARTIFACT_RELEASE, artifact.download);
  await copyFile(source, resolve(output, artifact.download));
  await copyFile(source, resolve(verification, artifact.name));
  await chmod(resolve(output, artifact.download), 0o644);
  await chmod(resolve(verification, artifact.name), 0o600);
}
await verifyPinnedArtifacts(verification);
process.stdout.write(`${JSON.stringify({
  status: "staged",
  directory: output,
  files: PINNED_ARTIFACTS.map((artifact) => artifact.download),
}, null, 2)}\n`);
