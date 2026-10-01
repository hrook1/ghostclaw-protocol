import assert from "node:assert/strict";
import test from "node:test";
import { commandInvocation } from "./lib/command-invocation.mjs";

test("Windows package shims run through the configured command processor", () => {
  const invocation = commandInvocation("npm.cmd", ["pack", "D:\\source"], {
    platform: "win32",
    comSpec: "C:\\Windows\\System32\\cmd.exe",
  });
  assert.deepEqual(invocation, {
    command: "C:\\Windows\\System32\\cmd.exe",
    args: ["/d", "/s", "/c", "npm.cmd", "pack", "D:\\source"],
  });
});

test("native executables run without a command processor", () => {
  assert.deepEqual(commandInvocation("npm", ["pack"], { platform: "darwin" }), {
    command: "npm",
    args: ["pack"],
  });
});
