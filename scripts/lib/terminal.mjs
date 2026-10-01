import { createInterface } from "node:readline/promises";

export function reportProgress(message, options = {}) {
  const stream = options.stream ?? process.stderr;
  const enabled = options.enabled ?? stream.isTTY === true;
  if (!enabled) return false;
  stream.write(`[GhostClaw] ${message}\n`);
  return true;
}

export async function confirm(question, options = {}) {
  if (options.yes === true) return true;
  if (!process.stdin.isTTY || !process.stderr.isTTY) return false;
  const terminal = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = (await terminal.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    terminal.close();
  }
}
