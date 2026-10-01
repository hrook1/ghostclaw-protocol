import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatTokenAmount } from "./protocol.mjs";

const cliPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "ghostclaw.mjs");

function runCli(args, input) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      env: { ...process.env, GHOSTCLAW_MCP_CHILD: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => child.kill("SIGKILL"), 180_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > 2 * 1024 * 1024) child.kill("SIGKILL");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stderr.length > 128 * 1024) child.kill("SIGKILL");
    });
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timeout);
      let parsed;
      try {
        parsed = JSON.parse((code === 0 ? stdout : stderr).trim());
      } catch {
        reject(new Error(code === 0 ? "The local wallet returned invalid data." : "The local wallet action failed."));
        return;
      }
      if (code !== 0) reject(new Error(parsed?.error ?? "The local wallet action failed."));
      else resolvePromise(parsed);
    });
    child.stdin.end(`${JSON.stringify(input)}\n`);
  });
}

export async function settleWithLocalRuntime(input) {
  const paid = await runCli(["pay", "--input", "-"], {
    merchant: input.merchant,
    "merchant-note-key": input.merchantNoteKey,
    amount: formatTokenAmount(input.amount),
    "request-base64": input.requirementBase64,
  });
  const response = JSON.parse(await readFile(paid.paymentResponse, "utf8"));
  return response;
}
