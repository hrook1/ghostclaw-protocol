export function playtestFundingPlan(input) {
  const publicBalance = BigInt(input.publicBalance);
  const targetAmount = BigInt(input.targetAmount);
  if (publicBalance < 0n || targetAmount <= 0n) {
    throw new Error("The playtest funding state is invalid.");
  }
  if (input.hasPrivateFunds === true) {
    return { action: "keep-private", amount: 0n };
  }
  if (publicBalance > 0n) {
    return {
      action: "deposit",
      amount: publicBalance > targetAmount ? targetAmount : publicBalance,
    };
  }
  if (input.faucetUsed !== true) {
    return { action: "claim-and-deposit", amount: targetAmount };
  }
  throw new Error("This wallet has no remaining valueless test gUSD.");
}

export async function runGuidedStart(dependencies) {
  const approved = await dependencies.approve();
  if (!approved) {
    return {
      status: "cancelled",
      action: "playtest-start",
      message: "GhostClaw made no changes.",
    };
  }

  dependencies.progress("Preparing the local wallet.");
  const setup = await dependencies.setup();
  dependencies.progress("Preparing private test funds.");
  const funding = await dependencies.fund();
  dependencies.progress("GhostClaw is ready.");

  return {
    status: "ready",
    action: "playtest-start",
    network: setup.network,
    account: setup.account,
    relay: setup.relay,
    localWallet: setup.localWallet,
    registration: setup.registration,
    budget: setup.budget,
    agentConnection: setup.agentConnection,
    testFunds: funding,
    next: "Open the connected agent client. Ask it to check the GhostClaw payment budget.",
  };
}
