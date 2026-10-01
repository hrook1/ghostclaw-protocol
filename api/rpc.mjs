import { handleVercelRelay } from "../scripts/lib/vercel-relay.mjs";

export default function rpc(request, response) {
  return handleVercelRelay(request, response, "/rpc");
}
