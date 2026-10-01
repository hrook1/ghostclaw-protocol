import { getAddress } from "viem";

function eventTime(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return parsed < 1_000_000_000_000 ? parsed * 1000 : parsed;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function senderAddress(value) {
  try {
    return getAddress(value);
  } catch {
    return null;
  }
}

export function positiveInteger(value, fallback, name) {
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(String(value)) || Number(value) < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return Number(value);
}

export function positiveNumber(value, fallback, name) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return parsed;
}

function failedSponsorship(value) {
  const states = [
    value?.status,
    value?.state,
    value?.confirmedStatus,
    value?.receipt?.status,
    value?.error?.message,
  ].filter((item) => item !== undefined && item !== null);
  return states.some((item) => /fail|revert|error|dropped/i.test(String(item)))
    || states.some((item) => item === 0 || item === "0x0");
}

export function evaluateSponsorships(sponsorships, options = {}) {
  const now = options.now ?? Date.now();
  const windowMinutes = options.windowMinutes ?? 10;
  const maxTotal = options.maxTotal ?? 50;
  const maxPerSender = options.maxPerSender ?? 10;
  const maxConfirmedUsd = options.maxConfirmedUsd ?? 1;
  const maxFailurePercent = options.maxFailurePercent ?? 25;
  const minimumFailureSamples = options.minimumFailureSamples ?? 5;
  const cutoff = now - (windowMinutes * 60_000);
  const counts = new Map();
  let totalUsd = 0;
  let recentTotal = 0;
  let failedTotal = 0;

  for (const sponsorship of sponsorships) {
    const grantedAt = eventTime(sponsorship?.grantedAt);
    if (grantedAt === null || grantedAt < cutoff || grantedAt > now + 60_000) continue;
    recentTotal += 1;
    if (failedSponsorship(sponsorship)) failedTotal += 1;
    const sender = senderAddress(sponsorship?.sender);
    if (sender) counts.set(sender, (counts.get(sender) ?? 0) + 1);
    const confirmedUsd = Number(sponsorship?.confirmedTotalUsd ?? 0);
    if (Number.isFinite(confirmedUsd) && confirmedUsd > 0) totalUsd += confirmedUsd;
  }

  const senderSpikes = [...counts]
    .filter(([, count]) => count > maxPerSender)
    .map(([sender, count]) => ({ sender, count }))
    .sort((left, right) => right.count - left.count);
  const globalSpike = recentTotal > maxTotal;
  const costSpike = totalUsd > maxConfirmedUsd;
  const failurePercent = recentTotal === 0 ? 0 : (failedTotal / recentTotal) * 100;
  const failureSpike = recentTotal >= minimumFailureSamples && failurePercent > maxFailurePercent;

  return {
    status: globalSpike || senderSpikes.length > 0 || costSpike || failureSpike ? "alert" : "healthy",
    windowMinutes,
    sponsorshipCount: recentTotal,
    confirmedUsd: Number(totalUsd.toFixed(8)),
    failedCount: failedTotal,
    failurePercent: Number(failurePercent.toFixed(2)),
    limits: {
      maxTotal,
      maxPerSender,
      maxConfirmedUsd,
      maxFailurePercent,
      minimumFailureSamples,
    },
    globalSpike,
    costSpike,
    failureSpike,
    senderSpikes,
  };
}

export async function getSponsorships(policyId, accessToken, fetchImpl = fetch) {
  const sponsorships = [];
  const seenCursors = new Set();
  let after = null;

  for (let page = 0; page < 10; page += 1) {
    if (after && seenCursors.has(after)) break;
    if (after) seenCursors.add(after);
    const url = new URL(
      `https://manage.g.alchemy.com/api/gasManager/policy/${encodeURIComponent(policyId)}/sponsorships`,
    );
    url.searchParams.set("limit", "100");
    if (after) url.searchParams.set("after", after);
    const response = await fetchImpl(url, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.error?.msg || !Array.isArray(payload?.data?.sponsorships)) {
      throw new Error(payload?.error?.msg ?? "Alchemy sponsorship monitoring failed.");
    }
    sponsorships.push(...payload.data.sponsorships);
    after = payload.data.after || null;
    if (!after) break;
  }

  return sponsorships;
}

export async function pausePolicy(policyId, accessToken, fetchImpl = fetch) {
  const response = await fetchImpl(
    `https://manage.g.alchemy.com/api/gasManager/policy/${encodeURIComponent(policyId)}/status`,
    {
      method: "PUT",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ status: "inactive" }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.error?.msg || payload?.data?.policy?.status !== "inactive") {
    throw new Error(payload?.error?.msg ?? "Alchemy did not pause the sponsorship policy.");
  }
  return "inactive";
}
