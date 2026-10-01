import { getAddress } from "viem";
import { NETWORK } from "./protocol.mjs";
import { validateDemoMerchantDeployment } from "./demo-merchant-store.mjs";

const PUBLIC_FIELDS = [
  "version", "status", "network", "merchant", "owner", "noteEncryptionPublicKey",
  "registeredAt", "registrationTransactionHash",
];
const MAX_DEPLOYMENT_BYTES = 3 * 1024 * 1024;
const CONFIGURATION_ERROR = "The hosted demo merchant configuration is unavailable.";

export function publicDemoMerchantDeployment(deployment) {
  if (
    deployment?.version !== 1
    || deployment.status !== "live-testnet-only"
    || deployment.network !== NETWORK
    || typeof deployment.owner !== "string"
    || !/^[1-9][0-9]{0,77}$/.test(deployment.owner)
    || typeof deployment.noteEncryptionPublicKey !== "string"
    || !deployment.noteEncryptionPublicKey
    || typeof deployment.registeredAt !== "string"
    || !Number.isFinite(Date.parse(deployment.registeredAt))
    || (deployment.registrationTransactionHash !== null
      && !/^0x[0-9a-f]{64}$/i.test(deployment.registrationTransactionHash ?? ""))
  ) {
    throw new Error(CONFIGURATION_ERROR);
  }
  const value = Object.fromEntries(PUBLIC_FIELDS.map((key) => [key, deployment[key]]));
  try {
    value.merchant = getAddress(value.merchant);
  } catch {
    throw new Error(CONFIGURATION_ERROR);
  }
  return value;
}

export function loadDemoMerchantDeployment(publicDeployment, environment = process.env) {
  try {
    const encoded = environment.GHOSTCLAW_DEMO_MERCHANT_DEPLOYMENT_JSON;
    if (typeof encoded !== "string" || !encoded || Buffer.byteLength(encoded) > MAX_DEPLOYMENT_BYTES) {
      throw new Error(CONFIGURATION_ERROR);
    }
    const deployment = JSON.parse(encoded);
    const expected = publicDemoMerchantDeployment(publicDeployment);
    const actual = publicDemoMerchantDeployment(deployment);
    if (PUBLIC_FIELDS.some((key) => actual[key] !== expected[key])) {
      throw new Error(CONFIGURATION_ERROR);
    }
    // Authenticate the seed before the hosted handler can use it or initialize Redis.
    validateDemoMerchantDeployment(deployment, environment.GHOSTCLAW_DEMO_MERCHANT_SECRET);
    return { ...actual, sealedState: deployment.sealedState };
  } catch {
    // Configuration failures must not echo secret JSON or its decrypted contents.
    throw new Error(CONFIGURATION_ERROR);
  }
}
