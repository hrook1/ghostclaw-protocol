import assert from "node:assert/strict";
import test from "node:test";
import {
  PLAYTEST_CREDIT_AMOUNT,
  DEPLOYED_FAUCET_AMOUNT,
  requestPlaytestAllocation,
} from "./lib/playtest-credit.mjs";

const ACCOUNT = "0x1111111111111111111111111111111111111111";

function tokenState({ used = false, balance = 0n, allocation = PLAYTEST_CREDIT_AMOUNT } = {}) {
  let faucetUsed = used;
  let tokenBalance = balance;
  let calls = 0;
  return {
    get calls() { return calls; },
    readToken: async (name) => {
      if (name === "faucetUsed") return faucetUsed;
      if (name === "FAUCET_AMOUNT") return DEPLOYED_FAUCET_AMOUNT;
      return tokenBalance;
    },
    claim: async () => {
      calls += 1;
      faucetUsed = true;
      tokenBalance += allocation;
      return { transactionHash: "0x1234" };
    },
  };
}

test("a new address receives exactly 100 public test gUSD", async () => {
  const token = tokenState();
  const result = await requestPlaytestAllocation({
    account: ACCOUNT,
    readToken: token.readToken,
    claim: token.claim,
  });
  assert.equal(PLAYTEST_CREDIT_AMOUNT, 100_000_000n);
  assert.equal(result.amount, 100_000_000n);
  assert.equal(result.balance, 100_000_000n);
  assert.equal(token.calls, 1);
});

test("an address cannot request the playtest allocation twice", async () => {
  const token = tokenState({ used: true });
  await assert.rejects(
    requestPlaytestAllocation({
      account: ACCOUNT,
      readToken: token.readToken,
      claim: token.claim,
    }),
    /already used its playtest claim/,
  );
  assert.equal(token.calls, 0);
});

test("an incorrect public faucet allocation is rejected", async () => {
  const token = tokenState({ allocation: 99_000_000n });
  await assert.rejects(
    requestPlaytestAllocation({
      account: ACCOUNT,
      readToken: token.readToken,
      claim: token.claim,
    }),
    /did not supply the required playtest credit/,
  );
});
