import { handleVercelRelay } from "../scripts/lib/vercel-relay.mjs";

export default function health(request, response) {
  return handleVercelRelay(request, response, "/health");
}
