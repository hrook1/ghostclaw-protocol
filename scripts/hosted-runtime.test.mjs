import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { nativeProverPackage, resolveNativeProver } from "./lib/native-prover.mjs";

const execFileAsync = promisify(execFile);
const project = resolve(import.meta.dirname, "..");

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test("the Vercel report function bundles the Linux note inspector", async () => {
  const config = JSON.parse(await readFile(resolve(project, "vercel.json"), "utf8"));
  const root = JSON.parse(await readFile(resolve(project, "package.json"), "utf8"));
  const functionConfig = config.functions?.["api/*.mjs"];
  assert.equal(functionConfig?.includeFiles, "node_modules/@ghostclaw/prover-linux-x64/**");
  assert.equal(functionConfig?.maxDuration, 30);
  assert.match(root.optionalDependencies?.["@ghostclaw/prover-linux-x64"] ?? "", /^\d+\.\d+\.\d+$/);
  assert.ok(root.files.includes("scripts/lib/file-security.mjs"));
  assert.ok(root.files.includes("scripts/lib/prover.mjs"));
  assert.ok(root.files.includes("scripts/lib/native-prover.mjs"));
});

test("the hosted note inspector starts without LAMBDA_TASK_ROOT", async (context) => {
  const home = await mkdtemp(join(tmpdir(), "ghostclaw-hosted-runtime-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const runtime = resolveNativeProver();
  const env = {
    ...process.env,
    VERCEL: "1",
    GHOSTCLAW_HOME: home,
  };
  delete env.LAMBDA_TASK_ROOT;

  if (!runtime) {
    const packageName = nativeProverPackage();
    assert.ok(packageName, `No GhostClaw native target exists for ${process.platform}/${process.arch}.`);
    const packageDirectory = resolve(
      project,
      "packages",
      packageName.replace("@ghostclaw/", ""),
    );
    const suffix = process.platform === "win32" ? ".exe" : "";
    const prover = resolve(packageDirectory, "bin", `ghostclaw-prover${suffix}`);
    const limiter = resolve(packageDirectory, "bin", `ghostclaw-prover-limiter${suffix}`);
    assert.equal(await exists(prover), true, `Build the ${packageName} binary before this test.`);
    assert.equal(await exists(limiter), true, `Build the ${packageName} limiter before this test.`);
    env.GHOSTCLAW_BUNDLED_PROVER = prover;
    env.GHOSTCLAW_BUNDLED_LIMITER = limiter;
  }

  const proverModule = new URL("./lib/prover.mjs", import.meta.url).href;
  const program = `
    import { inspectReceivedPayment } from ${JSON.stringify(proverModule)};
    try {
      await inspectReceivedPayment({});
      process.stdout.write("unexpected-success");
    } catch (error) {
      process.stdout.write(String(error.ghostclawStage ?? "missing-stage"));
    }
  `;
  const result = await execFileAsync(
    process.execPath,
    ["--input-type=module", "--eval", program],
    { cwd: project, env, timeout: 30_000, maxBuffer: 2 * 1024 * 1024 },
  );
  assert.equal(result.stdout, "merchant-note-inspector");
});
