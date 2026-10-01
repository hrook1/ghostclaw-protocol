import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { PINNED_ARTIFACTS } from "./lib/artifact-manifest.mjs";

const execFileAsync = promisify(execFile);

test("release packaging stages only committed, hash-pinned proving files", async (context) => {
  const output = await mkdtemp(join(tmpdir(), "ghostclaw-release-artifacts-"));
  context.after(() => rm(output, { recursive: true, force: true }));
  const result = await execFileAsync(process.execPath, [resolve("scripts", "stage-artifacts.mjs"), output], {
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.status, "staged");
  assert.deepEqual(summary.files, PINNED_ARTIFACTS.map((artifact) => artifact.download));
  for (const artifact of PINNED_ARTIFACTS) {
    const contents = await readFile(resolve(output, artifact.download));
    assert.equal(contents.length, artifact.size);
  }
});
