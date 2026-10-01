const alchemyEndpointPattern = /(https:\/\/[^\s"'`]*\.alchemy\.com\/v2\/)[A-Za-z0-9_-]+/gi;

export function redactFatalMessage(error: unknown) {
  let message = error instanceof Error
    ? error.stack || error.message
    : String(error);
  message = message.replace(alchemyEndpointPattern, "$1[REDACTED]");
  for (const name of [
    "ALCHEMY_BASE_SEPOLIA_RPC_URL",
    "ALCHEMY_DEPLOYMENT_GAS_POLICY_ID",
    "ALCHEMY_GAS_POLICY_ID",
    "ALCHEMY_AGENT_GAS_POLICY_ID",
    "ALCHEMY_UNDELEGATION_GAS_POLICY_ID",
    "ALCHEMY_FACILITATOR_GAS_POLICY_ID",
  ]) {
    const value = process.env[name]?.trim();
    if (value && value.length >= 12) message = message.replaceAll(value, "[REDACTED]");
  }
  return message;
}

export function installSecretRedactingFatalHandlers() {
  const fail = (error: unknown) => {
    console.error(redactFatalMessage(error));
    process.exit(1);
  };
  process.once("uncaughtException", fail);
  process.once("unhandledRejection", fail);
}
