import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

function configuredPath(name, fallback) {
  const configured = process.env[name]?.trim();
  if (!configured) return resolve(fallback);
  if (!isAbsolute(configured)) {
    throw new Error(`${name} must contain an absolute path.`);
  }
  return resolve(configured);
}

export const ghostclawHome = configuredPath("GHOSTCLAW_HOME", resolve(homedir(), ".ghostclaw"));
export const artifactCacheDir = resolve(ghostclawHome, "artifacts", "v2", "1.5.0");
export const runtimeBinDir = resolve(ghostclawHome, "bin", "1.5.7");
export const runtimeCacheDir = resolve(ghostclawHome, "cache", "1.5.7");

export function configuredArtifactDir() {
  const value = process.env.GHOSTCLAW_ARTIFACT_DIR?.trim();
  if (!value) return null;
  if (!isAbsolute(value)) {
    throw new Error("GHOSTCLAW_ARTIFACT_DIR must contain an absolute path.");
  }
  return resolve(value);
}
