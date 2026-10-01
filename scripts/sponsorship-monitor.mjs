#!/usr/bin/env node

import {
  evaluateSponsorships,
  getSponsorships,
  pausePolicy,
  positiveInteger,
  positiveNumber,
} from "./lib/sponsorship-monitor.mjs";

process.umask(0o077);

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function output(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

try {
  const policyId = requiredEnvironment("ALCHEMY_AGENT_GAS_POLICY_ID");
  const accessToken = requiredEnvironment("ALCHEMY_GAS_MANAGER_ACCESS_TOKEN");
  const windowMinutes = positiveInteger(
    process.env.GHOSTCLAW_MONITOR_WINDOW_MINUTES,
    10,
    "GHOSTCLAW_MONITOR_WINDOW_MINUTES",
  );
  const maxTotal = positiveInteger(
    process.env.GHOSTCLAW_MONITOR_MAX_TOTAL,
    50,
    "GHOSTCLAW_MONITOR_MAX_TOTAL",
  );
  const maxPerSender = positiveInteger(
    process.env.GHOSTCLAW_MONITOR_MAX_PER_SENDER,
    10,
    "GHOSTCLAW_MONITOR_MAX_PER_SENDER",
  );
  const maxConfirmedUsd = positiveNumber(
    process.env.GHOSTCLAW_MONITOR_MAX_CONFIRMED_USD,
    1,
    "GHOSTCLAW_MONITOR_MAX_CONFIRMED_USD",
  );
  const maxFailurePercent = positiveNumber(
    process.env.GHOSTCLAW_MONITOR_MAX_FAILURE_PERCENT,
    25,
    "GHOSTCLAW_MONITOR_MAX_FAILURE_PERCENT",
  );
  const minimumFailureSamples = positiveInteger(
    process.env.GHOSTCLAW_MONITOR_MIN_FAILURE_SAMPLES,
    5,
    "GHOSTCLAW_MONITOR_MIN_FAILURE_SAMPLES",
  );
  const sponsorships = await getSponsorships(policyId, accessToken);
  const result = evaluateSponsorships(sponsorships, {
    windowMinutes,
    maxTotal,
    maxPerSender,
    maxConfirmedUsd,
    maxFailurePercent,
    minimumFailureSamples,
  });

  if (result.status === "alert" && process.env.GHOSTCLAW_MONITOR_AUTO_PAUSE === "true") {
    result.policyAction = await pausePolicy(policyId, accessToken);
  }
  output(result);
  if (result.status === "alert") process.exitCode = 2;
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: error?.message ?? "Sponsorship monitoring failed." })}\n`);
  process.exitCode = 1;
}
