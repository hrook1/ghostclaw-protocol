export const ARTIFACT_RELEASE = "1.5.0";
export const DEFAULT_ARTIFACT_BASE_URL =
  "https://ghostclaw-confidential-payments.vercel.app/proving/1.5.0/";

export const PINNED_ARTIFACTS = Object.freeze([
  { name: "manifest.json", download: "ghostclaw-v2-manifest.json", size: 1_152, sha256: "a69b232f8b887b323908b0dc5f29baa474b1b230bb773c58fd53ef554f125803" },
  { name: "identity.ccs", download: "ghostclaw-v2-identity.ccs", size: 54_662, sha256: "ff9f1c503931e2452bf331775671bdec80e0c52c77f99d78056c1168ee3e7f4f" },
  { name: "identity.pk", download: "ghostclaw-v2-identity.pk", size: 296_592, sha256: "74881510e7f2feb340c463f5af5f87f7967f5643aadfc10722b061ec991076e7" },
  { name: "identity.vk", download: "ghostclaw-v2-identity.vk", size: 34_344, sha256: "cc1124fa97623364e8034dddbad4ecf9d3b25f304a4e8563084b4e5f7af563df" },
  { name: "deposit.ccs", download: "ghostclaw-v2-deposit.ccs", size: 80_205, sha256: "8bfc3034cd803f1cd2c2ef9731ee8e98258cd112b01d248e7d189ac0a9d8f7f0" },
  { name: "deposit.pk", download: "ghostclaw-v2-deposit.pk", size: 296_592, sha256: "b1aff1877634daa601b596f93cdb0f6c6e72992084a0f6bcdc3a94924e6b9fab" },
  { name: "deposit.vk", download: "ghostclaw-v2-deposit.vk", size: 34_344, sha256: "e48bbd5a698727de55c562280822e1c2b063673b0087f4832ce21fbde76b58e4" },
  { name: "spend.ccs", download: "ghostclaw-v2-spend.ccs", size: 343_688, sha256: "ce1f38e6cf79bbc10de1defc30ac44e5d529becc04218309ecc9b24e9e45cf13" },
  { name: "spend.pk", download: "ghostclaw-v2-spend.pk", size: 2_131_600, sha256: "4d8094cbf560ec32da91e1375e1861545b9f682e18de5bb69333b2593c8edb92" },
  { name: "spend.vk", download: "ghostclaw-v2-spend.vk", size: 34_344, sha256: "8cc213a6444c52c281fd543f4929376bbc2664b9891b37a61317ed9c5308647a" },
  { name: "withdraw.ccs", download: "ghostclaw-v2-withdraw.ccs", size: 303_465, sha256: "79a30f0fb6b704cccc310b424561dd3ee41da8f480e20b8ee4ad4cb442dfa7dc" },
  { name: "withdraw.pk", download: "ghostclaw-v2-withdraw.pk", size: 1_083_024, sha256: "07c7736a202141e183703a507bea2d65f0c5ffc9c5eee5fc250fa27b0f142c35" },
  { name: "withdraw.vk", download: "ghostclaw-v2-withdraw.vk", size: 34_344, sha256: "384b7e00f1f4eef9e7412f7395082dc2bfd01ccd09635d8e0bfb415b49db99ed" },
  { name: "bn254_g1.dat", download: "ghostclaw-bn254-g1.dat", size: 8_388_608, sha256: "3718ffbed583d8a279ccb2545196d5618e3fd97512b65aa051d2ebd0f57fb999" },
]);

export const ARTIFACT_DOWNLOAD_BYTES = PINNED_ARTIFACTS.reduce(
  (total, artifact) => total + artifact.size,
  0,
);
