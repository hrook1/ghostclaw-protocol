import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const cli = resolve(import.meta.dirname, "ghostclaw.mjs");

test("guided start needs one human approval before any wallet change", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "ghostclaw-guided-cancel-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const result = await execFileAsync(process.execPath, [cli, "start"], {
    env: {
      ...process.env,
      GHOSTCLAW_HOME: home,
      GHOSTCLAW_STATE_KEY: "91".repeat(32),
    },
    timeout: 10_000,
  });
  assert.deepEqual(JSON.parse(result.stdout), {
    status: "cancelled",
    action: "playtest-start",
    message: "GhostClaw made no changes.",
  });
  assert.equal(result.stderr, "");
});

test("help presents the guided start command first", async () => {
  const result = await execFileAsync(process.execPath, [cli, "help"], { timeout: 10_000 });
  const body = JSON.parse(result.stdout);
  assert.equal(body.usage[0], "npx ghostclaw start");
});
