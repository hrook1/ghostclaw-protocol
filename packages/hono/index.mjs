import { createGhostClawGate } from "ghostclaw/merchant";

export function ghostclaw(config) {
  const authorize = createGhostClawGate(config);
  return async function ghostclawMiddleware(context, next) {
    const result = await authorize({
      url: context.req.url,
      headers: context.req.raw.headers,
    });
    if (!result.paid) {
      for (const [name, value] of Object.entries(result.headers)) context.header(name, value);
      return context.json(result.body, 402);
    }
    context.set("ghostclawSettlement", result.settlement);
    await next();
  };
}
