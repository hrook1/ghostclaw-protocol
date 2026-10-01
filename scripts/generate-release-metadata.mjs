#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";

const [packageValue, archiveValue, tag, commit, outputValue] = process.argv.slice(2);
if (!packageValue || !archiveValue || !tag || !/^[0-9a-f]{40}$/.test(commit ?? "") || !outputValue) {
  throw new Error("Release metadata requires package, archive, tag, commit, and output values.");
}
const packageDir = resolve(packageValue);
const archivePath = resolve(archiveValue);
const outputDir = resolve(outputValue);

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function files(path) {
  const output = [];
  for (const name of (await readdir(path)).sort()) {
    const child = join(path, name);
    const details = await lstat(child);
    if (details.isSymbolicLink()) throw new Error(`A release file is a symbolic link: ${child}`);
    if (details.isDirectory()) output.push(...await files(child));
    else if (details.isFile()) output.push(child);
    else throw new Error(`A release path has an unsupported type: ${child}`);
  }
  return output;
}

const packageFiles = await files(packageDir);
const manifestLines = [];
for (const path of packageFiles) {
  manifestLines.push(`${digest(await readFile(path))}  ${relative(packageDir, path)}`);
}
const archiveName = basename(archivePath);
await writeFile(
  join(outputDir, `${archiveName}.files.sha256`),
  `${manifestLines.join("\n")}\n`,
  { mode: 0o644 },
);

const packageLock = JSON.parse(await readFile(join(packageDir, "package-lock.json"), "utf8"));
const npmComponents = Object.entries(packageLock.packages ?? {})
  .filter(([path, value]) => path && value?.version)
  .map(([path, value]) => ({
    type: "library",
    name: path.replace(/^node_modules\//, ""),
    version: value.version,
    hashes: value.integrity ? [{ alg: "SRI", content: value.integrity }] : undefined,
    purl: `pkg:npm/${encodeURIComponent(path.replace(/^node_modules\//, ""))}@${value.version}`,
  }));
const goMod = await readFile(join(packageDir, "go.mod"), "utf8");
const goComponents = [...goMod.matchAll(/^\s*([^\s()]+)\s+(v[^\s]+)(?:\s+\/\/ indirect)?$/gm)]
  .filter(([, name]) => name.includes("."))
  .map(([, name, version]) => ({
    type: "library",
    name,
    version,
    purl: `pkg:golang/${name}@${version}`,
  }));
const serialHex = digest(Buffer.from(`${tag}:${commit}`, "utf8"));
const serialUuid = [
  serialHex.slice(0, 8),
  serialHex.slice(8, 12),
  serialHex.slice(12, 16),
  serialHex.slice(16, 20),
  serialHex.slice(20, 32),
].join("-");
const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  serialNumber: `urn:uuid:${serialUuid}`,
  version: 1,
  metadata: {
    component: {
      type: "application",
      name: packageLock.name,
      version: packageLock.version,
    },
  },
  components: [...npmComponents, ...goComponents],
};
await writeFile(
  join(outputDir, `${archiveName}.sbom.cdx.json`),
  `${JSON.stringify(sbom, null, 2)}\n`,
  { mode: 0o644 },
);

const archiveDigest = digest(await readFile(archivePath));
const provenance = {
  _type: "https://in-toto.io/Statement/v1",
  subject: [{ name: archiveName, digest: { sha256: archiveDigest } }],
  predicateType: "https://slsa.dev/provenance/v1",
  predicate: {
    buildDefinition: {
      buildType: "https://ghostclaw.dev/build/git-archive/v1",
      externalParameters: { tag },
      resolvedDependencies: [{
        uri: "git+https://github.com/hrook1/ghostclaw-protocol",
        digest: { gitCommit: commit },
      }],
    },
    runDetails: {
      builder: { id: "https://ghostclaw.dev/release-builder/v1" },
      metadata: { invocationId: `${tag}:${commit}` },
    },
  },
};
await writeFile(
  join(outputDir, `${archiveName}.intoto.jsonl`),
  `${JSON.stringify(provenance)}\n`,
  { mode: 0o644 },
);
