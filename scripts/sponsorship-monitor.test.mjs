import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateSponsorships,
  getSponsorships,
  pausePolicy,
  positiveInteger,
  positiveNumber,
} from "./lib/sponsorship-monitor.mjs";

const NOW = Date.parse("2026-07-31T12:00:00Z");
const ADDRESS_A = "0x50A45b3D93D34A2996fa5Ba45E7c864Ef2c42D9f";
const ADDRESS_B = "0x7BD10Aa7D3f176c87B236f0b057283d62220b2F4";

function sponsorship(sender, secondsAgo, usd = "0.01") {
  return {
    sender,
    grantedAt: new Date(NOW - (secondsAgo * 1000)).toISOString(),
    confirmedTotalUsd: usd,
  };
}

test("the monitor finds a sender spike inside the selected window", () => {
  const result = evaluateSponsorships([
    sponsorship(ADDRESS_A, 30),
    sponsorship(ADDRESS_A, 60),
    sponsorship(ADDRESS_A, 90),
    sponsorship(ADDRESS_B, 120),
    sponsorship(ADDRESS_B, 900),
  ], { now: NOW, windowMinutes: 5, maxTotal: 10, maxPerSender: 2 });

  assert.equal(result.status, "alert");
  assert.equal(result.sponsorshipCount, 4);
  assert.deepEqual(result.senderSpikes, [{ sender: ADDRESS_A, count: 3 }]);
  assert.equal(result.confirmedUsd, 0.04);
});

test("the monitor finds a global spike across different senders", () => {
  const result = evaluateSponsorships([
    sponsorship(ADDRESS_A, 30),
    sponsorship(ADDRESS_B, 60),
  ], { now: NOW, windowMinutes: 5, maxTotal: 1, maxPerSender: 5 });

  assert.equal(result.status, "alert");
  assert.equal(result.globalSpike, true);
  assert.deepEqual(result.senderSpikes, []);
});

test("monitor limits accept positive integers only", () => {
  assert.equal(positiveInteger(undefined, 10, "LIMIT"), 10);
  assert.equal(positiveInteger("4", 10, "LIMIT"), 4);
  assert.throws(() => positiveInteger("0", 10, "LIMIT"), /positive integer/);
  assert.equal(positiveNumber("0.5", 1, "COST"), 0.5);
  assert.throws(() => positiveNumber("0", 1, "COST"), /positive number/);
});

test("the monitor triggers the cost and revert-rate kill switches", () => {
  const failed = Array.from({ length: 5 }, (_, index) => ({
    ...sponsorship(index % 2 ? ADDRESS_A : ADDRESS_B, 30 + index, "0.3"),
    status: index < 2 ? "reverted" : "confirmed",
  }));
  const result = evaluateSponsorships(failed, {
    now: NOW,
    windowMinutes: 5,
    maxTotal: 50,
    maxPerSender: 10,
    maxConfirmedUsd: 1,
    maxFailurePercent: 25,
    minimumFailureSamples: 5,
  });
  assert.equal(result.status, "alert");
  assert.equal(result.costSpike, true);
  assert.equal(result.failureSpike, true);
  assert.equal(result.failedCount, 2);
  assert.equal(result.failurePercent, 40);
});

test("sponsorship history keeps the access token in the authorization header", async () => {
  const requests = [];
  const result = await getSponsorships("policy-id", "secret-token", async (url, options) => {
    requests.push({ url: String(url), options });
    const first = requests.length === 1;
    return {
      ok: true,
      json: async () => ({
        data: {
          sponsorships: [{ sender: first ? ADDRESS_A : ADDRESS_B }],
          after: first ? "next-page" : null,
        },
      }),
    };
  });

  assert.equal(result.length, 2);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url.includes("secret-token"), false);
  assert.equal(requests[0].options.headers.authorization, "Bearer secret-token");
  assert.equal(requests[1].url.includes("after=next-page"), true);
});

test("automatic shutdown sends no secret in the request body", async () => {
  let captured;
  const status = await pausePolicy("policy-id", "secret-token", async (url, options) => {
    captured = { url: String(url), options };
    return {
      ok: true,
      json: async () => ({ data: { policy: { status: "inactive" } } }),
    };
  });

  assert.equal(status, "inactive");
  assert.deepEqual(JSON.parse(captured.options.body), { status: "inactive" });
  assert.equal(captured.options.body.includes("secret-token"), false);
  assert.equal(captured.options.headers.authorization, "Bearer secret-token");
});
