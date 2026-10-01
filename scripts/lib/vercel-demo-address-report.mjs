import { createGhostClawGate } from "../../packages/merchant-core/index.mjs";
import { buildAddressReport, createAddressReportHandler, DemoReportStore } from "./demo-address-report.mjs";
import { DemoMerchantStateStore, validateDemoMerchantDeployment } from "./demo-merchant-store.mjs";
import { importMerchantSettlement } from "./merchant-wallet.mjs";
import { publicClient } from "./alchemy-adapter.mjs";
import { SharedRelayRateLimiter } from "./relay-rate-limiter.mjs";
import { UpstashStore } from "./upstash-store.mjs";
import { rateLimitEnvironment } from "./vercel-relay.mjs";

let handler;

function requiredSecret(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export function createVercelAddressReportHandler(deployment, dependencies = {}) {
  const secret = dependencies.secret ?? requiredSecret("GHOSTCLAW_DEMO_MERCHANT_SECRET");
  const rateLimit = dependencies.rateLimit ?? rateLimitEnvironment();
  const redis = dependencies.redis ?? new UpstashStore({
    url: rateLimit.url,
    token: rateLimit.token,
  });
  const identity = validateDemoMerchantDeployment(deployment, secret);
  const merchantStore = new DemoMerchantStateStore({ redis, secret, deployment });
  const gate = (dependencies.createGate ?? createGhostClawGate)({
    price: "1",
    description: "Base Sepolia address report",
    merchant: identity.merchant,
    noteEncryptionPublicKey: identity.noteEncryptionPublicKey,
    importSettlement: (input) => importMerchantSettlement(
      input,
      merchantStore.dependencies(dependencies.merchantDependencies),
    ),
  });
  const limiter = dependencies.limiter ?? new SharedRelayRateLimiter({
    url: rateLimit.url,
    token: rateLimit.token,
    keySecret: requiredSecret("GHOSTCLAW_RATE_LIMIT_KEY_SECRET"),
    namespace: "ghostclaw-demo",
  });
  return createAddressReportHandler({
    gate,
    limiter,
    merchant: identity.merchant,
    price: "1",
    store: new DemoReportStore({ redis, secret }),
    buildReport: (address) => buildAddressReport(address, {
      publicClient: dependencies.publicClient ?? publicClient,
      fetchImpl: dependencies.fetchImpl ?? fetch,
    }),
  });
}

export function handleVercelAddressReport(request, response, deployment) {
  try {
    const resolvedDeployment = typeof deployment === "function" ? deployment() : deployment;
    handler ??= createVercelAddressReportHandler(resolvedDeployment);
  } catch {
    const body = JSON.stringify({ error: "address_report_unavailable" });
    response.writeHead(503, {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(body),
    });
    response.end(body);
    return;
  }
  return handler(request, response);
}
