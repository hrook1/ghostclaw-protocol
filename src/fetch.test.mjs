import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("fetch pays once and reuses the durable settlement after a retry", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "ghostclaw-fetch-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const fetchModule = new URL("../scripts/lib/x402-client.mjs", import.meta.url).href;
  const policyModule = new URL("../scripts/lib/agent-policy.mjs", import.meta.url).href;
  const stateModule = new URL("../scripts/lib/state.mjs", import.meta.url).href;
  const protocolModule = new URL("../scripts/lib/protocol.mjs", import.meta.url).href;
  const program = `
    import { fetchDetailed } from ${JSON.stringify(fetchModule)};
    import { getPublicPolicy, setHumanPolicy } from ${JSON.stringify(policyModule)};
    import { defaultAgentState, saveAgentState } from ${JSON.stringify(stateModule)};
    import { CONTRACTS, NETWORK } from ${JSON.stringify(protocolModule)};
    await saveAgentState(defaultAgentState(), true);
    const policyTime = new Date();
    await setHumanPolicy({
      maxPerPayment: "10", maxPerSession: "20", maxPerDay: "30",
      merchantAllowlist: [], merchantDenylist: [],
      expiresAt: new Date(policyTime.getTime() + 30 * 24 * 60 * 60 * 1_000).toISOString(),
    }, policyTime);
    const merchant = "0x3333333333333333333333333333333333333333";
    const requirement = Buffer.from(JSON.stringify({ x402Version: 2, accepts: [{
      scheme: "ghostclaw-confidential-x402-v2", network: NETWORK, amount: "1000000",
      asset: CONTRACTS.token, merchant, pool: CONTRACTS.pool,
      merchantNoteEncryptionPublicKey: "A".repeat(64),
      extra: { ghostclaw: { origin: "https://merchant.example", pool: CONTRACTS.pool,
        noteEncryptionPublicKey: "A".repeat(64) } },
    }] })).toString("base64");
    let calls = 0;
    let settlements = 0;
    let failAfterSettlement = true;
    const fetchImpl = async (_url, init) => {
      calls += 1;
      if (!new Headers(init.headers).has("payment-signature")) {
        return new Response("payment", { status: 402, headers: { "payment-required": requirement } });
      }
      if (failAfterSettlement) {
        failAfterSettlement = false;
        return new Response("temporary resource delivery failure", { status: 503 });
      }
      return new Response("report", { status: 200, headers: { "content-type": "text/plain" } });
    };
    const settle = async () => {
      settlements += 1;
      return { scheme: "ghostclaw-confidential-x402-v2", merchant,
        transactionHash: "0x" + "34".repeat(32) };
    };
    let firstError;
    try {
      await fetchDetailed("https://merchant.example/report", {}, { fetchImpl, settle });
    } catch (error) { firstError = error.code; }
    const second = await fetchDetailed("https://merchant.example/report", {}, {
      fetchImpl,
      settle: async () => { throw new Error("settled twice"); },
    });
    const policy = await getPublicPolicy();
    process.stdout.write(JSON.stringify({
      firstError, second: await second.response.text(), calls, settlements,
      transactionHash: second.payment.transactionHash,
      remainingSession: policy.remainingSession,
      remainingToday: policy.remainingToday,
    }));
  `;
  const result = await execFileAsync(process.execPath, ["--input-type=module", "--eval", program], {
    env: {
      ...process.env,
      GHOSTCLAW_HOME: join(directory, ".ghostclaw"),
      GHOSTCLAW_STATE_KEY: "83".repeat(32),
    },
  });
  assert.deepEqual(JSON.parse(result.stdout), {
    firstError: "GHOSTCLAW_RESOURCE_DELIVERY_FAILED",
    second: "report",
    calls: 4,
    settlements: 1,
    transactionHash: `0x${"34".repeat(32)}`,
    remainingSession: "19",
    remainingToday: "29",
  });
});
