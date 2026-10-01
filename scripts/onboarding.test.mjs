import assert from "node:assert/strict";
import test from "node:test";
import { playtestFundingPlan, runGuidedStart } from "./lib/onboarding.mjs";
import { reportProgress } from "./lib/terminal.mjs";

test("guided start uses one approval and returns one safe summary", async () => {
  const calls = [];
  const result = await runGuidedStart({
    approve: async () => { calls.push("approve"); return true; },
    progress: (message) => calls.push(`progress:${message}`),
    setup: async () => {
      calls.push("setup");
      return {
        network: "base-sepolia",
        account: "0x1111111111111111111111111111111111111111",
        owner: "private-owner-field",
        noteEncryptionPublicKey: "public-note-key",
        relay: "ghostclaw-sponsored-relay",
        localWallet: "created",
        registration: { state: "created", sponsored: true },
        budget: { maxPerPayment: "10" },
        agentConnection: { status: "connected" },
      };
    },
    fund: async () => {
      calls.push("fund");
      return { status: "deposited", amount: "100", sponsored: true };
    },
  });
  assert.equal(calls.filter((item) => item === "approve").length, 1);
  assert.equal(calls.indexOf("setup") < calls.indexOf("fund"), true);
  assert.equal(result.status, "ready");
  assert.equal(result.testFunds.amount, "100");
  assert.equal("owner" in result, false);
  assert.equal("noteEncryptionPublicKey" in result, false);
});

test("guided start cancellation does not create a wallet or funds", async () => {
  let mutations = 0;
  const result = await runGuidedStart({
    approve: async () => false,
    progress: () => {},
    setup: async () => { mutations += 1; },
    fund: async () => { mutations += 1; },
  });
  assert.equal(result.status, "cancelled");
  assert.equal(mutations, 0);
});

test("progress uses stderr and never changes standard output", () => {
  let text = "";
  const stream = { isTTY: true, write: (value) => { text += value; } };
  assert.equal(reportProgress("Checking the local prover.", { stream }), true);
  assert.equal(text, "[GhostClaw] Checking the local prover.\n");
  assert.equal(reportProgress("Hidden", { stream, enabled: false }), false);
  assert.equal(text, "[GhostClaw] Checking the local prover.\n");
});

test("guided funding is safe to resume after each completed step", () => {
  assert.deepEqual(playtestFundingPlan({
    hasPrivateFunds: true,
    publicBalance: 0n,
    faucetUsed: true,
    targetAmount: 100n,
  }), { action: "keep-private", amount: 0n });
  assert.deepEqual(playtestFundingPlan({
    hasPrivateFunds: false,
    publicBalance: 100n,
    faucetUsed: true,
    targetAmount: 100n,
  }), { action: "deposit", amount: 100n });
  assert.deepEqual(playtestFundingPlan({
    hasPrivateFunds: false,
    publicBalance: 150n,
    faucetUsed: false,
    targetAmount: 100n,
  }), { action: "deposit", amount: 100n });
  assert.deepEqual(playtestFundingPlan({
    hasPrivateFunds: false,
    publicBalance: 0n,
    faucetUsed: false,
    targetAmount: 100n,
  }), { action: "claim-and-deposit", amount: 100n });
  assert.throws(() => playtestFundingPlan({
    hasPrivateFunds: false,
    publicBalance: 0n,
    faucetUsed: true,
    targetAmount: 100n,
  }), /no remaining valueless test gUSD/);
});
