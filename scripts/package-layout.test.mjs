import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const targets = [
  ["darwin", "arm64"], ["darwin", "x64"], ["linux", "arm64"],
  ["linux", "x64"], ["win32", "x64"],
];

test("the root package exposes one CLI, one library, and platform-specific optional provers", async () => {
  const root = JSON.parse(await readFile("package.json", "utf8"));
  const version = (await readFile("VERSION", "utf8")).trim();
  assert.equal(root.name, "ghostclaw");
  assert.equal(root.version, version);
  assert.equal(root.private, undefined);
  assert.equal(root.scripts?.postinstall, undefined);
  assert.equal(root.bin.ghostclaw, "scripts/ghostclaw.mjs");
  assert.equal(root.exports["."], "./src/index.mjs");
  assert.equal(root.exports["./merchant"], "./packages/merchant-core/index.mjs");
  assert.equal(root.files.includes("scripts/lib/relay-server.mjs"), false);
  assert.equal(root.files.includes("scripts/lib/note-tree-service.mjs"), false);
  assert.equal(root.files.includes("scripts/lib/sponsorship-policy.mjs"), true);
  assert.equal(root.files.includes("scripts/lib/onboarding.mjs"), true);
  assert.match(root.ghostclaw?.nativeRuntimeRelease ?? "", /^\d+\.\d+\.\d+$/);
  for (const [platform, arch] of targets) {
    const name = `@ghostclaw/prover-${platform}-${arch}`;
    assert.equal(root.optionalDependencies[name], root.ghostclaw.nativeRuntimeRelease);
    const child = JSON.parse(await readFile(`packages/prover-${platform}-${arch}/package.json`, "utf8"));
    assert.equal(child.name, name);
    assert.equal(child.version, version);
    assert.equal(child.scripts?.postinstall, undefined);
    assert.deepEqual(child.os, [platform]);
    assert.deepEqual(child.cpu, [arch]);
  }
});

test("merchant adapters use the same release and public root package", async () => {
  const version = (await readFile("VERSION", "utf8")).trim();
  for (const name of ["express", "hono", "next"]) {
    const child = JSON.parse(await readFile(`packages/${name}/package.json`, "utf8"));
    assert.equal(child.version, version);
    assert.equal(child.dependencies.ghostclaw, version);
    assert.equal(child.scripts?.postinstall, undefined);
  }
});

test("the MCP surface contains only fetch and budget inspection", async () => {
  const version = (await readFile("VERSION", "utf8")).trim();
  const source = await readFile("scripts/mcp-server.mjs", "utf8");
  assert.equal(source.includes(`version: "${version}"`), true);
  const tools = [...source.matchAll(/server\.registerTool\("([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(tools, ["ghostclaw_fetch", "ghostclaw_check_budget"]);
  for (const forbidden of ["deposit", "withdraw", "backup", "restore", "benchmark", "claim"] ) {
    assert.equal(tools.some((tool) => tool.includes(forbidden)), false);
  }
});

test("the local MCP connection uses the current package version", async () => {
  const version = (await readFile("VERSION", "utf8")).trim();
  const source = await readFile("scripts/lib/connect-client.mjs", "utf8");
  assert.equal(source.includes(`ghostclaw@${version}`), true);
});
