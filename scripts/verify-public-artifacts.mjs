#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { ARTIFACT_RELEASE, PINNED_ARTIFACTS } from "./lib/artifact-manifest.mjs";

const root = resolve("public", "proving", ARTIFACT_RELEASE);
for (const artifact of PINNED_ARTIFACTS) {
  const path = resolve(root, artifact.download);
  const details = await stat(path);
  if (!details.isFile() || details.size !== artifact.size) {
    throw new Error(`The public proving file has another size: ${artifact.download}`);
  }
  const digest = createHash("sha256").update(await readFile(path)).digest("hex");
  if (digest !== artifact.sha256) {
    throw new Error(`The public proving file has another hash: ${artifact.download}`);
  }
}

process.stdout.write(`${JSON.stringify({
  status: "verified",
  release: ARTIFACT_RELEASE,
  files: PINNED_ARTIFACTS.length,
}, null, 2)}\n`);
