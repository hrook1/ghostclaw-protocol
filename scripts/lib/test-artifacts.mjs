import { copyFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ARTIFACT_RELEASE, PINNED_ARTIFACTS } from "./artifact-manifest.mjs";

export async function copyCommittedArtifactSet(destination) {
  await mkdir(destination, { recursive: true, mode: 0o700 });
  for (const artifact of PINNED_ARTIFACTS) {
    const source = resolve("public", "proving", ARTIFACT_RELEASE, artifact.download);
    await copyFile(source, join(destination, artifact.name));
  }
  return destination;
}
