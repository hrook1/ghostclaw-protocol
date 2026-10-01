import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { ghostclawHome } from "./paths.mjs";

const execFileAsync = promisify(execFile);

function spawnInherited(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: "inherit",
      windowsHide: false,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise({ code });
        return;
      }
      const reason = signal ? `signal ${signal}` : `exit code ${code}`;
      reject(new Error(`The agent client stopped with ${reason}.`));
    });
  });
}

export function localRuntimeCommand() {
  const packaged = process.env.GHOSTCLAW_EXECUTABLE?.trim();
  if (packaged) return { command: resolve(packaged), args: ["mcp"] };
  return {
    command: process.platform === "win32" ? "npx.cmd" : "npx",
    args: ["-y", "ghostclaw@1.5.7", "mcp"],
  };
}

export function connectedAgentClient(connection) {
  const entries = Array.isArray(connection?.clients) ? connection.clients : [connection];
  const connected = new Set(entries
    .filter((entry) => entry?.status === "connected")
    .map((entry) => entry.client));
  return ["claude-code", "codex", "claude-desktop"].find((client) => connected.has(client)) ?? null;
}

export function agentClientLabel(client) {
  if (client === "claude-code") return "Claude Code";
  if (client === "claude-desktop") return "Claude Desktop";
  if (client === "codex") return "Codex";
  return "the connected agent client";
}

export function guidedDemoPrompt(input) {
  const account = String(input?.account ?? "");
  if (!/^0x[0-9a-fA-F]{40}$/.test(account)) {
    throw new Error("The guided demo account is invalid.");
  }
  if (input?.network !== "base-sepolia") {
    throw new Error("The guided demo network is invalid.");
  }
  const reportUrl = new URL("https://ghostclaw-confidential-payments.vercel.app/demo/address-report");
  reportUrl.searchParams.set("address", account);
  return [
    "Start the GhostClaw guided demo now.",
    "Call ghostclaw_check_budget before you answer.",
    "Then give the human a short wallet summary with these facts:",
    `Network: Base Sepolia. Public wallet: ${account}.`,
    "The local wallet is ready. Private test funds are available.",
    "Keep the exact private balance and all private note data outside the conversation.",
    "Show the spending limits and remaining totals from ghostclaw_check_budget.",
    "Explain that the demo report costs 1 valueless test gUSD.",
    `Ask exactly: Would you like me to buy the demo address report for ${account}?`,
    "Wait for an explicit yes. Do not buy the report before the human answers.",
    `After yes, call ghostclaw_fetch with this URL: ${reportUrl.toString()}`,
    "Return the report in plain language. Do not ask for a wallet address or private wallet data.",
  ].join("\n");
}

export function shouldLaunchAgentClient(options = {}) {
  const environment = options.environment ?? process.env;
  const ci = String(environment.CI ?? "").toLowerCase();
  return options.disabled !== true
    && options.stdinTTY === true
    && options.stdoutTTY === true
    && !["1", "true", "yes"].includes(ci)
    && environment.GHOSTCLAW_NO_LAUNCH !== "1";
}

function launchSpec(client, platform, prompt) {
  if (client === "claude-code") return { command: "claude", args: prompt ? [prompt] : [] };
  if (client === "codex") return { command: "codex", args: prompt ? [prompt] : [] };
  if (client === "claude-desktop" && platform === "darwin") {
    return { command: "open", args: ["-a", "Claude"] };
  }
  if (client === "claude-desktop" && platform === "win32") {
    return {
      command: "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-Command", "Start-Process", "Claude"],
    };
  }
  return null;
}

export async function launchConnectedAgent(connection, options = {}) {
  const client = connectedAgentClient(connection);
  if (!client) return { status: "manual", reason: "No connected agent client is available." };
  const spec = launchSpec(client, options.platform ?? process.platform, options.prompt);
  if (!spec) {
    return { status: "manual", client, reason: `${agentClientLabel(client)} cannot open automatically on this system.` };
  }
  const runner = options.runner ?? spawnInherited;
  await runner(spec.command, spec.args, {
    cwd: options.cwd ?? process.cwd(),
    env: options.environment ?? process.env,
  });
  return { status: "opened", client };
}

function runtimeEnvironment() {
  return {
    GHOSTCLAW_HOME: ghostclawHome,
    ...(process.env.GHOSTCLAW_PASSPHRASE_FILE?.trim()
      ? { GHOSTCLAW_PASSPHRASE_FILE: resolve(process.env.GHOSTCLAW_PASSPHRASE_FILE.trim()) }
      : {}),
  };
}

async function available(command, runner) {
  try {
    await (runner ?? execFileAsync)(process.platform === "win32" ? "where" : "which", [command], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

function claudeDesktopConfigPath() {
  if (process.platform === "darwin") {
    return resolve(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA?.trim();
    return appData ? resolve(appData, "Claude", "claude_desktop_config.json") : null;
  }
  return resolve(homedir(), ".config", "Claude", "claude_desktop_config.json");
}

async function exists(path) {
  if (!path) return false;
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function backupConfig(path) {
  if (!await exists(path)) return null;
  const backup = `${path}.ghostclaw-backup-${Date.now()}-${randomBytes(4).toString("hex")}`;
  await copyFile(path, backup);
  await chmod(backup, 0o600).catch(() => {});
  return backup;
}

function environmentArgs(flag) {
  return Object.entries(runtimeEnvironment()).flatMap(([key, value]) => [flag, `${key}=${value}`]);
}

export function connectionSnippet(runtime = localRuntimeCommand()) {
  return {
    mcpServers: {
      ghostclaw: {
        command: runtime.command,
        args: runtime.args,
        env: runtimeEnvironment(),
      },
    },
  };
}

export async function detectAgentClients(options = {}) {
  const runner = options.runner ?? execFileAsync;
  const [claude, codex, desktop] = await Promise.all([
    available("claude", options.lookupRunner ?? runner),
    available("codex", options.lookupRunner ?? runner),
    exists(options.claudeDesktopPath ?? claudeDesktopConfigPath()),
  ]);
  return [
    ...(claude ? ["claude-code"] : []),
    ...(codex ? ["codex"] : []),
    ...(desktop ? ["claude-desktop"] : []),
  ];
}

async function connectClaudeCode(options) {
  const runner = options.runner ?? execFileAsync;
  if (!await available("claude", options.lookupRunner ?? runner)) throw new Error("Claude Code is unavailable.");
  const scope = options.scope === "project" ? "project" : "user";
  const configPath = scope === "project"
    ? resolve(options.projectDirectory ?? process.cwd(), ".mcp.json")
    : resolve(options.claudeUserConfigPath ?? resolve(homedir(), ".claude.json"));
  const backup = await backupConfig(configPath);
  const runtime = options.runtime ?? localRuntimeCommand();
  await runner("claude", ["mcp", "remove", "--scope", scope, "ghostclaw"], { timeout: 15_000 }).catch(() => {});
  await runner("claude", [
    "mcp", "add", "--transport", "stdio", "--scope", scope, "ghostclaw",
    ...environmentArgs("--env"), "--", runtime.command, ...runtime.args,
  ], { timeout: 30_000 });
  return { status: "connected", client: "claude-code", scope, backup };
}

async function connectCodex(options) {
  const runner = options.runner ?? execFileAsync;
  if (!await available("codex", options.lookupRunner ?? runner)) throw new Error("Codex is unavailable.");
  const configPath = resolve(options.codexConfigPath ?? resolve(homedir(), ".codex", "config.toml"));
  const backup = await backupConfig(configPath);
  const runtime = options.runtime ?? localRuntimeCommand();
  await runner("codex", ["mcp", "remove", "ghostclaw"], { timeout: 15_000 }).catch(() => {});
  await runner("codex", [
    "mcp", "add", "ghostclaw", ...environmentArgs("--env"), "--", runtime.command, ...runtime.args,
  ], { timeout: 30_000 });
  return { status: "connected", client: "codex", backup };
}

async function connectClaudeDesktop(options) {
  const path = options.claudeDesktopPath ?? claudeDesktopConfigPath();
  if (!path) throw new Error("The Claude Desktop configuration path is unavailable.");
  const backup = await backupConfig(path);
  let config = {};
  if (await exists(path)) {
    try {
      config = JSON.parse(await readFile(path, "utf8"));
    } catch {
      throw new Error("The Claude Desktop configuration does not contain valid JSON.");
    }
  }
  const snippet = connectionSnippet(options.runtime ?? localRuntimeCommand());
  config.mcpServers = { ...(config.mcpServers ?? {}), ...snippet.mcpServers };
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600).catch(() => {});
  return { status: "connected", client: "claude-desktop", backup };
}

export async function connectAgentClient(client, options = {}) {
  if (client === "claude" || client === "claude-code") return connectClaudeCode(options);
  if (client === "codex") return connectCodex(options);
  if (client === "claude-desktop") return connectClaudeDesktop(options);
  if (client === "auto") {
    const clients = await detectAgentClients(options);
    const connected = [];
    for (const name of clients) connected.push(await connectAgentClient(name, options));
    if (connected.length === 0) {
      return { status: "manual", configuration: connectionSnippet(options.runtime) };
    }
    return { status: "connected", clients: connected };
  }
  if (client === "manual") return { status: "manual", configuration: connectionSnippet(options.runtime) };
  throw new Error("Use claude-code, claude-desktop, codex, auto, or manual.");
}
