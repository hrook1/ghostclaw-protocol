import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verifyNativeProver } from "./lib/native-prover.mjs";

test("the runtime rejects a changed optional native prover", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "ghostclaw-native-package-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  await mkdir(bin, { mode: 0o700 });
  const prover = join(bin, "ghostclaw-prover");
  const limiter = join(bin, "ghostclaw-prover-limiter");
  const checksums = join(root, "checksums.json");
  await writeFile(prover, "prover", { mode: 0o700 });
  await writeFile(limiter, "limiter", { mode: 0o700 });
  const record = (file, contents) => ({
    file,
    bytes: Buffer.byteLength(contents),
    sha256: createHash("sha256").update(contents).digest("hex"),
  });
  await writeFile(checksums, `${JSON.stringify({
    version: 1,
    package: "@ghostclaw/prover-darwin-x64",
    target: "darwin/x64",
    files: [record("ghostclaw-prover", "prover"), record("ghostclaw-prover-limiter", "limiter")],
  })}\n`, { mode: 0o600 });
  const runtime = {
    source: "@ghostclaw/prover-darwin-x64",
    prover,
    limiter,
    checksums,
  };
  assert.equal(await verifyNativeProver(runtime, "darwin", "x64"), runtime);
  await writeFile(prover, "changed", { mode: 0o700 });
  await assert.rejects(
    verifyNativeProver(runtime, "darwin", "x64"),
    /failed verification: ghostclaw-prover/,
  );
});
