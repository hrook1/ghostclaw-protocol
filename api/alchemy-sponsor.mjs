import { handleVercelRelay } from "../scripts/lib/vercel-relay.mjs";

export default function alchemySponsor(request, response) {
  return handleVercelRelay(request, response, "/alchemy/sponsor");
}
