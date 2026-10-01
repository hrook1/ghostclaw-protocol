import publicDeployment from "../deployments/base-sepolia-demo-merchant.json" with { type: "json" };
import { loadDemoMerchantDeployment } from "../scripts/lib/demo-merchant-deployment.mjs";
import { handleVercelAddressReport } from "../scripts/lib/vercel-demo-address-report.mjs";

export default function demoAddressReport(request, response) {
  return handleVercelAddressReport(request, response, () => loadDemoMerchantDeployment(publicDeployment));
}
