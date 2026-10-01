import assert from "node:assert/strict";
import test from "node:test";
import { inspectReceivedPayment } from "./lib/prover.mjs";

test("received-note inspection does not load proving artifacts", async () => {
  const runtime = {
    binary: "/runtime/ghostclaw-prover",
    limiterBinary: "/runtime/ghostclaw-prover-limiter",
    nativeSource: "test",
  };
  const request = { note: "encrypted-test-note" };
  let invocation;
  const result = await inspectReceivedPayment(request, {
    prepareNativeRuntime: async () => runtime,
    spawnJson: async (selectedRuntime, args, selectedRequest) => {
      invocation = { selectedRuntime, args, selectedRequest };
      return { status: "checked" };
    },
  });

  assert.deepEqual(result, { status: "checked" });
  assert.equal(invocation.selectedRuntime, runtime);
  assert.equal(invocation.selectedRequest, request);
  assert.deepEqual(invocation.args, ["inspect-received-payment", "--input", "-", "--out", "-"]);
  assert.equal(invocation.args.includes("--artifacts"), false);
});

test("received-note inspection reports safe runtime stages", async () => {
  await assert.rejects(
    inspectReceivedPayment({}, {
      prepareNativeRuntime: async () => { throw new Error("private runtime detail"); },
    }),
    (error) => error.ghostclawStage === "merchant-native-runtime",
  );
  await assert.rejects(
    inspectReceivedPayment({}, {
      prepareNativeRuntime: async () => ({ binary: "prover", limiterBinary: "limiter" }),
      spawnJson: async () => { throw new Error("private note detail"); },
    }),
    (error) => error.ghostclawStage === "merchant-note-inspector",
  );
});
