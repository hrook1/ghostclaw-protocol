#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createPublicClient, getAddress, http, keccak256 } from "viem";
import { baseSepolia } from "viem/chains";

process.umask(0o077);

const DEPLOYMENT = getAddress("0x69007702764179f14F51cdce752f4f775d74E139");
const ENTRY_POINT = getAddress("0x0000000071727De22E5E9d8BAf0edAc6f37da032");
const EXECUTION_INSTALL_DELEGATE = getAddress("0x0000000000008e6a39E03C7156e46b238C9E2036");
const EXPECTED_RUNTIME_BYTES = 23_741;
const EXPECTED_RUNTIME_HASH = "0xecfc0328ce4d953a4d452e11f54b578fa2d7f2f8126246d1120ca24d11845081";

function argument(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

function word(address) {
  return address.slice(2).toLowerCase().padStart(64, "0");
}

function replaceReferences(bytecode, references, replacement) {
  const bytes = [...bytecode];
  for (const reference of references) {
    assert.equal(reference.length, 32, "An immutable reference has an unexpected length.");
    const start = reference.start * 2;
    const end = start + reference.length * 2;
    const existing = bytes.slice(start, end).join("");
    assert.match(existing, /^0+$/, "A compiled immutable placeholder is not empty.");
    bytes.splice(start, reference.length * 2, ...replacement);
  }
  return bytes;
}

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

const artifactPath = resolve(argument("--artifact"));
const rpcUrl = argument("--rpc", "https://sepolia.base.org");
const outputPath = argument("--out");
const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
const object = artifact?.deployedBytecode?.object;
const immutableReferences = artifact?.deployedBytecode?.immutableReferences;
assert.match(object, /^0x[0-9a-fA-F]+$/, "The build artifact has no deployed runtime bytecode.");
assert.ok(immutableReferences && typeof immutableReferences === "object");

const groups = Object.values(immutableReferences);
assert.equal(groups.length, 3, "The delegated account must contain three immutable groups.");
const fiveReferenceGroups = groups.filter((group) => group.length === 5);
const oneReferenceGroups = groups.filter((group) => group.length === 1);
assert.equal(fiveReferenceGroups.length, 1, "The EntryPoint immutable reference count changed.");
assert.equal(oneReferenceGroups.length, 2, "The one-use immutable reference count changed.");

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(rpcUrl, { retryCount: 0, timeout: 30_000 }),
});
assert.equal(await client.getChainId(), 84_532);
const liveCode = await client.getBytecode({ address: DEPLOYMENT });
assert.ok(liveCode && liveCode !== "0x", "The delegated account runtime is missing.");

const template = object.slice(2).toLowerCase().split("");
const withEntryPoint = replaceReferences(template, fiveReferenceGroups[0], word(ENTRY_POINT));
const assignments = [
  [DEPLOYMENT, EXECUTION_INSTALL_DELEGATE],
  [EXECUTION_INSTALL_DELEGATE, DEPLOYMENT],
];
const candidates = assignments.map(([first, second]) => {
  const withFirst = replaceReferences(withEntryPoint, oneReferenceGroups[0], word(first));
  const withSecond = replaceReferences(withFirst, oneReferenceGroups[1], word(second));
  return `0x${withSecond.join("")}`;
});
const matches = candidates.filter((candidate) => candidate === liveCode.toLowerCase());
assert.equal(matches.length, 1, "The compiled runtime does not match the Base Sepolia deployment.");

const reproduced = matches[0];
assert.equal((reproduced.length - 2) / 2, EXPECTED_RUNTIME_BYTES);
assert.equal(keccak256(reproduced), EXPECTED_RUNTIME_HASH);
assert.equal((liveCode.length - 2) / 2, EXPECTED_RUNTIME_BYTES);
assert.equal(keccak256(liveCode), EXPECTED_RUNTIME_HASH);

const result = {
  checkedAt: new Date().toISOString(),
  chainId: 84_532,
  contract: DEPLOYMENT,
  compilerArtifact: "out-optimized/SemiModularAccount7702.sol/SemiModularAccount7702.json",
  runtimeBytes: EXPECTED_RUNTIME_BYTES,
  runtimeKeccak256: EXPECTED_RUNTIME_HASH,
  immutableValues: {
    self: DEPLOYMENT,
    entryPoint: ENTRY_POINT,
    executionInstallDelegate: EXECUTION_INSTALL_DELEGATE,
  },
  exactRuntimeMatch: true,
};
if (outputPath) await atomicJson(resolve(outputPath), result);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
