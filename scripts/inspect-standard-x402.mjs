#!/usr/bin/env node

import { inspectStandardX402Requirement } from "../packages/merchant-core/index.mjs";

const [value] = process.argv.slice(2);
let url;
try {
  url = new URL(value);
} catch {
  throw new Error("Provide one valid x402 endpoint URL.");
}
if (url.protocol !== "https:") throw new Error("The x402 endpoint must use HTTPS.");

const response = await fetch(url, {
  redirect: "manual",
  signal: AbortSignal.timeout(30_000),
});
if (response.status !== 402) {
  throw new Error(`The endpoint returned HTTP ${response.status} instead of 402.`);
}
const encoded = response.headers.get("payment-required");
if (!encoded || encoded.length > 128 * 1024) {
  throw new Error("The endpoint did not return a valid PAYMENT-REQUIRED header.");
}
let requirement;
try {
  requirement = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
} catch {
  throw new Error("The PAYMENT-REQUIRED header does not contain valid JSON.");
}
process.stdout.write(`${JSON.stringify({
  endpoint: url.origin,
  status: response.status,
  result: inspectStandardX402Requirement(requirement),
}, null, 2)}\n`);
