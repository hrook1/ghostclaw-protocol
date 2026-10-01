import { createGhostClawGate } from "ghostclaw/merchant";

export function ghostclaw(config) {
  const authorize = createGhostClawGate(config);
  return async function ghostclawMiddleware(request, response, next) {
    try {
      const origin = `${request.protocol}://${request.get("host")}`;
      const result = await authorize({
        url: new URL(request.originalUrl ?? request.url, origin).toString(),
        headers: request.headers,
      });
      if (!result.paid) {
        for (const [name, value] of Object.entries(result.headers)) response.set(name, value);
        response.status(402).json(result.body);
        return;
      }
      response.locals.ghostclaw = result.settlement;
      next();
    } catch (error) {
      next(error);
    }
  };
}
