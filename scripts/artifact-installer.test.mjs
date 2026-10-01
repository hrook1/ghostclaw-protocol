import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { artifactDownloadSummary, verifyPinnedArtifacts } from "./lib/artifact-installer.mjs";
import { copyCommittedArtifactSet } from "./lib/test-artifacts.mjs";

test("the offline artifact directory verifies every package-pinned hash", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "ghostclaw-pinned-artifacts-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  await copyCommittedArtifactSet(directory);
  assert.equal(await verifyPinnedArtifacts(directory), directory);
  assert.equal(artifactDownloadSummary().mebibytes, 12.5);
  await writeFile(join(directory, "deposit.vk"), "tampered", { mode: 0o600 });
  await assert.rejects(verifyPinnedArtifacts(directory), /failed verification: deposit.vk/);
});
