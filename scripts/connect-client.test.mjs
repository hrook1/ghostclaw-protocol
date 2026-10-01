import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  agentClientLabel,
  connectAgentClient,
  connectedAgentClient,
  guidedDemoPrompt,
  launchConnectedAgent,
  shouldLaunchAgentClient,
} from "./lib/connect-client.mjs";

test("Codex configuration is backed up before the CLI changes it", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "ghostclaw-codex-config-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = join(directory, "config.toml");
  await writeFile(configPath, "model = \"test\"\n", { mode: 0o600 });
  const calls = [];
  const runner = async (command, args) => {
    calls.push([command, args]);
    return { stdout: "", stderr: "" };
  };
  const result = await connectAgentClient("codex", {
    runner,
    lookupRunner: runner,
    codexConfigPath: configPath,
    runtime: { command: "ghostclaw-test", args: ["mcp"] },
  });
  assert.equal(await readFile(result.backup, "utf8"), "model = \"test\"\n");
  assert.equal(calls.some(([command, args]) => command === "codex" && args.includes("add")), true);
  assert.equal(calls.some(([, args]) => args.some((item) => item.startsWith("GHOSTCLAW_HOME="))), true);
});

test("Claude Desktop JSON is preserved and receives one GhostClaw MCP entry", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "ghostclaw-claude-config-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = join(directory, "claude_desktop_config.json");
  await writeFile(configPath, '{"theme":"dark","mcpServers":{"existing":{"command":"x"}}}\n', { mode: 0o600 });
  const result = await connectAgentClient("claude-desktop", {
    claudeDesktopPath: configPath,
    runtime: { command: "ghostclaw-test", args: ["mcp"] },
  });
  const config = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(config.theme, "dark");
  assert.equal(config.mcpServers.existing.command, "x");
  assert.equal(config.mcpServers.ghostclaw.command, "ghostclaw-test");
  assert.equal(await readFile(result.backup, "utf8"), '{"theme":"dark","mcpServers":{"existing":{"command":"x"}}}\n');
});

test("the connected client selector uses the interactive client priority", () => {
  const connection = {
    status: "connected",
    clients: [
      { status: "connected", client: "claude-desktop" },
      { status: "connected", client: "codex" },
      { status: "connected", client: "claude-code" },
    ],
  };
  assert.equal(connectedAgentClient(connection), "claude-code");
  assert.equal(agentClientLabel("claude-code"), "Claude Code");
  assert.equal(connectedAgentClient({ status: "manual" }), null);
});

test("automatic launch needs an interactive terminal and permits an explicit stop", () => {
  const environment = {};
  assert.equal(shouldLaunchAgentClient({ stdinTTY: true, stdoutTTY: true, environment }), true);
  assert.equal(shouldLaunchAgentClient({ stdinTTY: false, stdoutTTY: true, environment }), false);
  assert.equal(shouldLaunchAgentClient({ stdinTTY: true, stdoutTTY: false, environment }), false);
  assert.equal(shouldLaunchAgentClient({ stdinTTY: true, stdoutTTY: true, environment, disabled: true }), false);
  assert.equal(shouldLaunchAgentClient({ stdinTTY: true, stdoutTTY: true, environment: { CI: "true" } }), false);
  assert.equal(shouldLaunchAgentClient({ stdinTTY: true, stdoutTTY: true, environment: { CI: "1" } }), false);
  assert.equal(shouldLaunchAgentClient({
    stdinTTY: true,
    stdoutTTY: true,
    environment: { GHOSTCLAW_NO_LAUNCH: "1" },
  }), false);
});

test("Claude Code opens through one fixed inherited command", async () => {
  const calls = [];
  const prompt = "Start the guided demo.";
  const result = await launchConnectedAgent(
    { status: "connected", client: "claude-code" },
    {
      cwd: "/test/workspace",
      environment: { PATH: "/test/bin" },
      prompt,
      runner: async (command, args, options) => calls.push({ command, args, options }),
    },
  );
  assert.deepEqual(result, { status: "opened", client: "claude-code" });
  assert.deepEqual(calls, [{
    command: "claude",
    args: [prompt],
    options: { cwd: "/test/workspace", env: { PATH: "/test/bin" } },
  }]);
});

test("Codex opens when it is the connected command-line client", async () => {
  const calls = [];
  const result = await launchConnectedAgent(
    { status: "connected", clients: [{ status: "connected", client: "codex" }] },
    { prompt: "Guide the user.", runner: async (command, args) => calls.push([command, args]) },
  );
  assert.deepEqual(result, { status: "opened", client: "codex" });
  assert.deepEqual(calls, [["codex", ["Guide the user."]]]);
});

test("the guided prompt gives safe wallet context and waits for approval", () => {
  const account = "0x1111111111111111111111111111111111111111";
  const prompt = guidedDemoPrompt({ account, network: "base-sepolia" });
  assert.match(prompt, /Call ghostclaw_check_budget before you answer/);
  assert.match(prompt, new RegExp(`Public wallet: ${account}`));
  assert.match(prompt, /Private test funds are available/);
  assert.match(prompt, /Keep the exact private balance .* outside the conversation/);
  assert.match(prompt, /Wait for an explicit yes/);
  assert.match(prompt, new RegExp(`address=${account}`));
  assert.doesNotMatch(prompt, /privateBalance|spendKey|noteEncryption/);
});

test("the guided prompt rejects an untrusted account or network", () => {
  assert.throws(() => guidedDemoPrompt({ account: "address", network: "base-sepolia" }), /account is invalid/);
  assert.throws(() => guidedDemoPrompt({
    account: "0x1111111111111111111111111111111111111111",
    network: "base-mainnet",
  }), /network is invalid/);
});

test("Claude Desktop uses the operating-system application launcher", async () => {
  const macCalls = [];
  const windowsCalls = [];
  await launchConnectedAgent(
    { status: "connected", client: "claude-desktop" },
    { platform: "darwin", runner: async (command, args) => macCalls.push([command, args]) },
  );
  await launchConnectedAgent(
    { status: "connected", client: "claude-desktop" },
    { platform: "win32", runner: async (command, args) => windowsCalls.push([command, args]) },
  );
  assert.deepEqual(macCalls, [["open", ["-a", "Claude"]]]);
  assert.deepEqual(windowsCalls, [[
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", "Start-Process", "Claude"],
  ]]);
});

test("unsupported desktop launch returns a manual instruction", async () => {
  const result = await launchConnectedAgent(
    { status: "connected", client: "claude-desktop" },
    { platform: "linux", runner: async () => assert.fail("the runner must not start") },
  );
  assert.equal(result.status, "manual");
  assert.equal(result.client, "claude-desktop");
});
