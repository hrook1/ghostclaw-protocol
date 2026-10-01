import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("an exact human approval overrides one out-of-budget payment", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "ghostclaw-budget-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const policyModule = new URL("./lib/agent-policy.mjs", import.meta.url).href;
  const stateModule = new URL("./lib/state.mjs", import.meta.url).href;
  const merchant = "0x1111111111111111111111111111111111111111";
  const program = `
    import {
      approveBudgetRequest,
      authorizePayment,
      getPublicPolicy,
      recordPaymentUsage,
      setHumanPolicy,
    } from ${JSON.stringify(policyModule)};
    import { defaultAgentState, saveAgentState } from ${JSON.stringify(stateModule)};
    await saveAgentState(defaultAgentState(), true);
    const now = new Date("2026-08-07T12:00:00.000Z");
    await setHumanPolicy({
      maxPerPayment: "5",
      maxPerSession: "10",
      maxPerDay: "20",
      merchantAllowlist: [],
      merchantDenylist: [],
      expiresAt: "2026-09-01T00:00:00.000Z",
    }, now);
    const payment = {
      merchant: ${JSON.stringify(merchant)},
      origin: "https://merchant.example",
      amount: "6000000",
      fingerprint: "ab".repeat(32),
    };
    let budgetError;
    try { await authorizePayment(payment, now); } catch (error) {
      budgetError = { code: error.code, id: error.approvalId, reasons: error.reasons };
    }
    const approved = await approveBudgetRequest(budgetError.id, now);
    const allowed = await authorizePayment(payment, now);
    await recordPaymentUsage({ ...payment, approvalId: allowed.approvalId }, {
      scheme: "ghostclaw-confidential-x402-v2",
      merchant: payment.merchant,
      transactionHash: "0x" + "12".repeat(32),
    }, now);
    const policy = await getPublicPolicy(now);
    process.stdout.write(JSON.stringify({ budgetError, approved, allowed, policy }));
  `;
  const result = await execFileAsync(process.execPath, ["--input-type=module", "--eval", program], {
    env: {
      ...process.env,
      GHOSTCLAW_HOME: join(directory, ".ghostclaw"),
      GHOSTCLAW_STATE_KEY: "81".repeat(32),
    },
  });
  const value = JSON.parse(result.stdout);
  assert.equal(value.budgetError.code, "GHOSTCLAW_BUDGET_EXCEEDED");
  assert.deepEqual(value.budgetError.reasons, ["per-payment-limit"]);
  assert.match(value.budgetError.id, /^gca_[A-Za-z0-9_-]{24}$/);
  assert.equal(value.approved.approvalId, value.budgetError.id);
  assert.equal(value.allowed.policyOverride, true);
  assert.equal(value.policy.remainingSession, "4");
});

test("merchant denylist and budget expiry fail before proving", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "ghostclaw-budget-deny-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const policyModule = new URL("./lib/agent-policy.mjs", import.meta.url).href;
  const stateModule = new URL("./lib/state.mjs", import.meta.url).href;
  const merchant = "0x2222222222222222222222222222222222222222";
  const program = `
    import { authorizePayment, setHumanPolicy } from ${JSON.stringify(policyModule)};
    import { defaultAgentState, saveAgentState } from ${JSON.stringify(stateModule)};
    await saveAgentState(defaultAgentState(), true);
    await setHumanPolicy({
      maxPerPayment: "10", maxPerSession: "20", maxPerDay: "30",
      merchantAllowlist: [], merchantDenylist: [${JSON.stringify(merchant)}],
      expiresAt: "2026-08-07T12:02:00.000Z",
    }, new Date("2026-08-07T12:00:00.000Z"));
    try {
      await authorizePayment({
        merchant: ${JSON.stringify(merchant)}, origin: "https://merchant.example",
        amount: "1000000", fingerprint: "cd".repeat(32),
      }, new Date("2026-08-07T12:03:00.000Z"));
    } catch (error) { process.stdout.write(JSON.stringify(error.reasons)); }
  `;
  const result = await execFileAsync(process.execPath, ["--input-type=module", "--eval", program], {
    env: {
      ...process.env,
      GHOSTCLAW_HOME: join(directory, ".ghostclaw"),
      GHOSTCLAW_STATE_KEY: "82".repeat(32),
    },
  });
  assert.deepEqual(JSON.parse(result.stdout), ["budget-expired", "merchant-denied"]);
});
