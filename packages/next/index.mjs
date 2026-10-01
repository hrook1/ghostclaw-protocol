import { createGhostClawGate } from "ghostclaw/merchant";

export function withGhostClaw(handler, config) {
  const authorize = createGhostClawGate(config);
  return async function ghostclawRoute(request, context) {
    const result = await authorize({ url: request.url, headers: request.headers });
    if (!result.paid) {
      return Response.json(result.body, { status: 402, headers: result.headers });
    }
    return handler(request, { ...context, ghostclawSettlement: result.settlement });
  };
}
