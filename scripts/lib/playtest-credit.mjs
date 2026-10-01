export const PLAYTEST_CREDIT_AMOUNT = 100_000_000n;
export const DEPLOYED_FAUCET_AMOUNT = PLAYTEST_CREDIT_AMOUNT;

export async function requestPlaytestAllocation({ account, readToken, claim }) {
  if (await readToken("faucetUsed", [account])) {
    throw new Error("This Base address already used its playtest claim.");
  }
  const faucetAmount = await readToken("FAUCET_AMOUNT");
  if (faucetAmount !== DEPLOYED_FAUCET_AMOUNT) {
    throw new Error("The Base faucet amount does not match the playtest policy.");
  }
  const before = await readToken("balanceOf", [account]);
  const receipt = await claim();
  const [used, balance] = await Promise.all([
    readToken("faucetUsed", [account]),
    readToken("balanceOf", [account]),
  ]);
  const amount = balance - before;
  if (!used || amount !== PLAYTEST_CREDIT_AMOUNT) {
    throw new Error("The Base faucet did not supply the required playtest credit.");
  }
  return { amount, balance, receipt };
}
