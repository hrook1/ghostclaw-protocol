const MAX_REDIS_RESPONSE_BYTES = 3 * 1024 * 1024;

function checkedKey(value) {
  const key = String(value ?? "");
  if (!/^[A-Za-z0-9:_-]{1,240}$/.test(key)) {
    throw new Error("The Redis key is invalid.");
  }
  return key;
}

export class UpstashStore {
  constructor({ url, token, fetchImpl = fetch }) {
    const endpoint = new URL(url);
    if (
      endpoint.protocol !== "https:"
      || endpoint.username
      || endpoint.password
      || endpoint.search
      || endpoint.hash
    ) {
      throw new Error("The hosted state store must use a credential-free HTTPS URL.");
    }
    if (typeof token !== "string" || token.length < 16) {
      throw new Error("The hosted state store token is required.");
    }
    this.url = endpoint.toString().replace(/\/$/, "");
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  async command(parts) {
    const response = await this.fetchImpl(this.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(parts),
      signal: AbortSignal.timeout(8_000),
    });
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_REDIS_RESPONSE_BYTES) {
      throw new Error("The hosted state store response is too large.");
    }
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error("The hosted state store returned invalid JSON.");
    }
    if (!response.ok || payload?.error) {
      throw new Error("The hosted state store is unavailable.");
    }
    return payload?.result;
  }

  get(key) {
    return this.command(["GET", checkedKey(key)]);
  }

  set(key, value, options = {}) {
    const command = ["SET", checkedKey(key), String(value)];
    if (options.nx === true) command.push("NX");
    if (options.px !== undefined) {
      if (!Number.isSafeInteger(options.px) || options.px < 1 || options.px > 86_400_000) {
        throw new Error("The Redis millisecond expiry is invalid.");
      }
      command.push("PX", String(options.px));
    }
    if (options.ex !== undefined) {
      if (!Number.isSafeInteger(options.ex) || options.ex < 1 || options.ex > 31_536_000) {
        throw new Error("The Redis second expiry is invalid.");
      }
      command.push("EX", String(options.ex));
    }
    return this.command(command);
  }

  del(key) {
    return this.command(["DEL", checkedKey(key)]);
  }

  eval(script, keys, args = []) {
    if (typeof script !== "string" || script.length === 0 || script.length > 8_192) {
      throw new Error("The Redis script is invalid.");
    }
    const checkedKeys = keys.map(checkedKey);
    return this.command(["EVAL", script, checkedKeys.length, ...checkedKeys, ...args.map(String)]);
  }
}
