import { handleVercelFacilitator } from "../scripts/lib/vercel-facilitator.mjs";

export default function facilitatorVerify(request, response) {
  return handleVercelFacilitator(request, response);
}
