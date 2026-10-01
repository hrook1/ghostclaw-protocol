import { getAddress } from "viem";
import { CONTRACTS, NETWORK, parseTokenAmount } from "../../scripts/lib/protocol.mjs";
import {
  importMerchantSettlement,
  localMerchantIdentity,
} from "../../scripts/lib/merchant-wallet.mjs";
const GHOSTCLAW_X402_SCHEME = "ghostclaw-confidential-x402-v2";
export const DEFAULT_FACILITATOR_URL =
  "https://ghostclaw-confidential-payments.vercel.app/facilitator/";

const MAX_FACILITATOR_BYTES = 64 * 1024;

function checkedFacilitatorUrl(value) {
  let url;
  try {
    url = new URL(value ?? process.env.GHOSTCLAW_FACILITATOR_URL);
  } catch {
    throw new Error("Set a valid GHOSTCLAW_FACILITATOR_URL.");
  }
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("The GhostClaw facilitator URL must use HTTPS.");
  }
  if (url.username || url.password || url.hash || url.search) {
    throw new Error("The GhostClaw facilitator URL contains unsupported fields.");
  }
  if (!url.pathname.endsWith("/")) url.pathname = `${url.pathname}/`;
  return url;
}

function checkedConfig(config, identity = null) {
  const noteKey = String(config.noteEncryptionPublicKey ?? identity?.noteEncryptionPublicKey ?? "");
  if (noteKey.length < 40 || noteKey.length > 512) {
    throw new Error("The merchant note encryption key is invalid.");
  }
  const amount = parseTokenAmount(String(config.price)).toString();
  if (BigInt(amount) <= 0n) throw new Error("The merchant price must be greater than zero.");
  return {
    merchant: getAddress(config.merchant ?? identity?.merchant),
    amount,
    noteKey,
    facilitator: checkedFacilitatorUrl(
      config.facilitatorUrl
      ?? process.env.GHOSTCLAW_FACILITATOR_URL
      ?? DEFAULT_FACILITATOR_URL,
    ),
    description: String(config.description ?? "Paid resource").slice(0, 200),
    onSettlement: config.onSettlement,
    fetchImpl: config.fetchImpl ?? globalThis.fetch,
  };
}

function requestOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("The paid merchant endpoint must use HTTPS.");
  }
  return url.origin;
}

function paymentRequiredFromChecked(checked, requestUrl) {
  return {
    x402Version: 2,
    error: "Payment required",
    resource: { url: String(requestUrl), description: checked.description },
    accepts: [{
      scheme: GHOSTCLAW_X402_SCHEME,
      network: NETWORK,
      amount: checked.amount,
      asset: CONTRACTS.token,
      payTo: checked.merchant,
      merchant: checked.merchant,
      pool: CONTRACTS.pool,
      merchantNoteEncryptionPublicKey: checked.noteKey,
      extra: {
        ghostclaw: {
          pool: CONTRACTS.pool,
          noteEncryptionPublicKey: checked.noteKey,
          origin: requestOrigin(requestUrl),
        },
      },
    }],
  };
}

export function createPaymentRequired(config, requestUrl) {
  return paymentRequiredFromChecked(checkedConfig(config), requestUrl);
}

export function encodePaymentRequired(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function paymentSignature(headers) {
  if (headers instanceof Headers) {
    return headers.get("payment-signature") ?? headers.get("x-payment");
  }
  const entries = Object.entries(headers ?? {});
  return entries.find(([name]) => ["payment-signature", "x-payment"].includes(name.toLowerCase()))?.[1] ?? null;
}

async function verifyWithFacilitator(config, signature) {
  if (typeof signature !== "string" || signature.length === 0 || signature.length > 128 * 1024) {
    throw new Error("The PAYMENT-SIGNATURE header is invalid.");
  }
  const url = new URL("verify", config.facilitator);
  const response = await config.fetchImpl(url, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      merchant: config.merchant,
      paymentSignature: signature,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error("The GhostClaw facilitator attempted a redirect.");
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_FACILITATOR_BYTES) {
    throw new Error("The GhostClaw facilitator response is too large.");
  }
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error("The GhostClaw facilitator returned invalid JSON.");
  }
  if (
    !response.ok
    || result?.status !== "settled"
    || result.scheme !== GHOSTCLAW_X402_SCHEME
    || result.verification !== "public-chain"
    || getAddress(result.merchant) !== config.merchant
    || typeof result.transactionHash !== "string"
  ) {
    throw new Error("The GhostClaw facilitator rejected the payment.");
  }
  return result;
}

export function createGhostClawGate(input) {
  const configPromise = (input.merchant && input.noteEncryptionPublicKey)
    ? Promise.resolve(checkedConfig(input))
    : (input.localMerchantIdentity ?? localMerchantIdentity)().then((identity) => (
        checkedConfig(input, identity)
      ));
  return async function authorize(request) {
    const config = await configPromise;
    const requirement = paymentRequiredFromChecked(config, request.url);
    const encodedRequirement = encodePaymentRequired(requirement);
    const signature = paymentSignature(request.headers);
    if (!signature) {
      return {
        paid: false,
        status: 402,
        headers: {
          "content-type": "application/json",
          "payment-required": encodedRequirement,
        },
        body: requirement,
      };
    }
    let settlement;
    try {
      settlement = await verifyWithFacilitator(config, signature);
    } catch (error) {
      if (error && typeof error === "object" && !error.ghostclawStage) {
        error.ghostclawStage = "facilitator-verification";
      }
      throw error;
    }
    const importSettlement = config.onSettlement
      ?? input.importSettlement
      ?? importMerchantSettlement;
    try {
      await importSettlement({
        settlement,
        paymentRequired: requirement,
        paymentRequiredBase64: encodedRequirement,
        paymentSignature: signature,
      });
    } catch (error) {
      if (error && typeof error === "object" && !error.ghostclawStage) {
        error.ghostclawStage = "merchant-note-import";
      }
      throw error;
    }
    return { paid: true, status: 200, settlement };
  };
}

export function inspectStandardX402Requirement(payload) {
  const requirements = Array.isArray(payload?.accepts) ? payload.accepts : [];
  const standard = requirements.find((item) => item?.scheme === "exact");
  if (!standard) return { standardExact: false, compatible: false, reason: "no-standard-exact-scheme" };
  return {
    standardExact: true,
    compatible: false,
    reason: "standard-exact-requires-public-token-transfer",
    publicFields: ["payer", "merchant", "asset", "amount", "transaction-time"],
  };
}
