import { CONTRACTS } from "./protocol.mjs";

function rpcError(payload) {
  return payload?.error?.message ?? "The independent Base simulation rejected the sponsored call.";
}

export async function simulateSponsorship(result, options = {}) {
  const rpcUrl = options.rpcUrl;
  const fetchImpl = options.fetchImpl ?? fetch;
  if (!rpcUrl) throw new Error("An independent simulation RPC URL is required.");
  let id = 1;
  for (const [index, call] of result.calls.entries()) {
    const accepted = result.acceptedCalls[index];
    const response = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "eth_call",
        params: [{
          from: result.sender,
          to: call.to,
          value: "0x0",
          data: call.data,
        }, "latest"],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.error || typeof payload?.result !== "string") {
      throw new Error(rpcError(payload));
    }
    if (accepted.target !== CONTRACTS.pool && accepted.target !== CONTRACTS.token) {
      throw new Error("The independent simulation returned an unexpected target.");
    }
    id += 1;
  }
  return true;
}
