import { createHmac, randomBytes } from "node:crypto";

const WINDOW_MS = 60_000;
export const AUTHORIZED_SENDER_LIMIT = 120;

function identity(value, secret) {
  return createHmac("sha256", secret)
    .update(String(value ?? "unknown"))
    .digest("hex")
    .slice(0, 32);
}

function recent(values, cutoff) {
  return values.filter((item) => item.time >= cutoff);
}

export class MemoryRelayRateLimiter {
  constructor(now = () => Date.now()) {
    this.now = now;
    this.buckets = new Map();
    this.keySecret = randomBytes(32);
  }

  check(entries, cost) {
    const cutoff = this.now() - WINDOW_MS;
    const checked = entries.map(([key, limit]) => {
      const values = recent(this.buckets.get(key) ?? [], cutoff);
      const used = values.reduce((total, item) => total + item.cost, 0);
      return { key, limit, values, used };
    });
    if (checked.some((item) => item.used + cost > item.limit)) return false;
    const time = this.now();
    for (const item of checked) {
      item.values.push({ time, cost });
      this.buckets.set(item.key, item.values);
    }
    return true;
  }

  preflight({ route, ip }) {
    return this.check([[`preflight:${route}:${identity(ip, this.keySecret)}`, 120]], 1);
  }

  allow({ route, method, ip, sender, cost = 1 }) {
    const entries = [
      ["authorized:global", 600],
      [`authorized:${route}:${method}`, method === "wallet_getCallsStatus" ? 1_200 : 600],
      [`authorized:ip:${identity(ip, this.keySecret)}`, 180],
    ];
    if (sender) entries.push([`authorized:sender:${identity(sender, this.keySecret)}`, AUTHORIZED_SENDER_LIMIT]);
    return this.check(entries, cost);
  }
}

const ATOMIC_LIMIT_SCRIPT = `
local cost = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
for i = 1, #KEYS do
  local current = tonumber(redis.call("GET", KEYS[i]) or "0")
  local limit = tonumber(ARGV[i + 2])
  if current + cost > limit then
    return {0, i, current}
  end
end
for i = 1, #KEYS do
  local next = redis.call("INCRBY", KEYS[i], cost)
  if next == cost then
    redis.call("PEXPIRE", KEYS[i], window)
  end
end
return {1, 0, 0}
`;

export class SharedRelayRateLimiter {
  constructor({ url, token, keySecret, fetchImpl = fetch, namespace = "ghostclaw" }) {
    const endpoint = new URL(url);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) {
      throw new Error("The shared rate-limit store must use a credential-free HTTPS URL.");
    }
    if (!token) throw new Error("The shared rate-limit store token is required.");
    if (!keySecret || String(keySecret).length < 32) {
      throw new Error("The shared rate-limit key secret must contain at least 32 characters.");
    }
    if (!/^[a-z0-9-]{1,64}$/i.test(namespace)) {
      throw new Error("The shared rate-limit namespace is invalid.");
    }
    this.url = endpoint.toString().replace(/\/$/, "");
    this.token = token;
    this.keySecret = keySecret;
    this.fetchImpl = fetchImpl;
    this.namespace = namespace;
  }

  async health() {
    const response = await this.fetchImpl(this.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(["PING"]),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error("The shared rate-limit store is unavailable.");
    const payload = await response.json();
    if (payload?.result !== "PONG") {
      throw new Error("The shared rate-limit store returned an invalid health response.");
    }
    return true;
  }

  async command(entries, cost) {
    const keys = entries.map(([key]) => `${this.namespace}:${key}`);
    const limits = entries.map(([, limit]) => String(limit));
    const response = await this.fetchImpl(this.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(["EVAL", ATOMIC_LIMIT_SCRIPT, keys.length, ...keys, String(cost), String(WINDOW_MS), ...limits]),
      signal: AbortSignal.timeout(5_000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(payload?.result)) {
      throw new Error("The shared rate-limit store is unavailable.");
    }
    return Number(payload.result[0]) === 1;
  }

  preflight({ route, ip }) {
    return this.command([[`preflight:${route}:${identity(ip, this.keySecret)}`, 120]], 1);
  }

  allow({ route, method, ip, sender, cost = 1 }) {
    const entries = [
      ["authorized:global", 600],
      [`authorized:${route}:${method}`, method === "wallet_getCallsStatus" ? 1_200 : 600],
      [`authorized:ip:${identity(ip, this.keySecret)}`, 180],
    ];
    if (sender) entries.push([`authorized:sender:${identity(sender, this.keySecret)}`, AUTHORIZED_SENDER_LIMIT]);
    return this.command(entries, cost);
  }
}
