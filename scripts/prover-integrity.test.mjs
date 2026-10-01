import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verifyArtifactSet } from "./lib/prover.mjs";
import { copyCommittedArtifactSet } from "./lib/test-artifacts.mjs";

test("proving artifacts are checked before local use", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "ghostclaw-artifact-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  await copyCommittedArtifactSet(directory);
  await verifyArtifactSet(directory);
  await writeFile(join(directory, "spend.vk"), "tampered\n", { mode: 0o600 });
  await assert.rejects(
    verifyArtifactSet(directory),
    /failed its SHA-256 check: spend.vk/,
  );
});
