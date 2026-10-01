import { createHash, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { chmod, lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  ARTIFACT_DOWNLOAD_BYTES,
  ARTIFACT_RELEASE,
  DEFAULT_ARTIFACT_BASE_URL,
  PINNED_ARTIFACTS,
} from "./artifact-manifest.mjs";
import { artifactCacheDir, configuredArtifactDir } from "./paths.mjs";

function currentUid() {
  return typeof process.getuid === "function" ? process.getuid() : null;
}

async function secureDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const details = await lstat(path);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error(`The proving-artifact path is not a safe directory: ${path}`);
  }
  if (currentUid() !== null && details.uid !== currentUid()) {
    throw new Error(`The proving-artifact directory has another owner: ${path}`);
  }
  await chmod(path, 0o700);
}

async function regularFile(path) {
  const details = await lstat(path);
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error(`The proving artifact is not a regular file: ${path}`);
  }
  if (currentUid() !== null && details.uid !== currentUid()) {
    throw new Error(`The proving artifact has another owner: ${path}`);
  }
  if ((details.mode & 0o022) !== 0) {
    throw new Error(`The proving artifact is writable by another user: ${path}`);
  }
  return details;
}

async function digestFile(path) {
  const hash = createHash("sha256");
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

export async function verifyPinnedArtifacts(directory) {
  const root = resolve(directory);
  for (const artifact of PINNED_ARTIFACTS) {
    const path = resolve(root, artifact.name);
    const details = await regularFile(path);
    if (details.size !== artifact.size || await digestFile(path) !== artifact.sha256) {
      throw new Error(`The pinned proving artifact failed verification: ${artifact.name}`);
    }
  }
  return root;
}

async function cacheIsValid(directory) {
  try {
    await verifyPinnedArtifacts(directory);
    return true;
  } catch {
    return false;
  }
}

function artifactBaseUrl() {
  const configured = process.env.GHOSTCLAW_ARTIFACT_BASE_URL?.trim();
  const value = configured || DEFAULT_ARTIFACT_BASE_URL;
  let url;
  try {
    url = new URL(value.endsWith("/") ? value : `${value}/`);
  } catch {
    throw new Error("GHOSTCLAW_ARTIFACT_BASE_URL is invalid.");
  }
  if (url.protocol !== "https:") {
    throw new Error("The proving-artifact source must use HTTPS.");
  }
  return url;
}

async function downloadArtifact(artifact, directory, fetchImpl, progress) {
  const source = new URL(artifact.download, artifactBaseUrl());
  const destination = resolve(directory, artifact.name);
  const temporary = `${destination}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  let received = 0;
  try {
    const response = await fetchImpl(source, {
      redirect: "error",
      signal: AbortSignal.timeout(120_000),
      headers: { accept: "application/octet-stream" },
    });
    if (!response.ok || !response.body) {
      throw new Error(`The proving-artifact server returned HTTP ${response.status}.`);
    }
    const length = response.headers.get("content-length");
    if (length !== null && Number(length) !== artifact.size) {
      throw new Error(`The proving-artifact server returned another size for ${artifact.name}.`);
    }
    const stream = Readable.fromWeb(response.body).map((chunk) => {
      received += chunk.length;
      if (received > artifact.size) {
        throw new Error(`The proving artifact exceeded its pinned size: ${artifact.name}`);
      }
      progress?.(chunk.length, artifact.name);
      return chunk;
    });
    await pipeline(stream, createWriteStream(temporary, { flags: "wx", mode: 0o600 }));
    if (received !== artifact.size || await digestFile(temporary) !== artifact.sha256) {
      throw new Error(`The downloaded proving artifact failed verification: ${artifact.name}`);
    }
    await rename(temporary, destination);
    await regularFile(destination);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

export function artifactDownloadSummary() {
  return {
    release: ARTIFACT_RELEASE,
    files: PINNED_ARTIFACTS.length,
    bytes: ARTIFACT_DOWNLOAD_BYTES,
    mebibytes: Number((ARTIFACT_DOWNLOAD_BYTES / 1024 / 1024).toFixed(1)),
  };
}

export async function installArtifacts(options = {}) {
  const offline = configuredArtifactDir();
  if (offline) {
    return { directory: await verifyPinnedArtifacts(offline), source: "offline", downloaded: false };
  }
  if (await cacheIsValid(artifactCacheDir)) {
    return { directory: artifactCacheDir, source: "cache", downloaded: false };
  }
  await secureDirectory(artifactCacheDir);
  const summary = artifactDownloadSummary();
  if (options.announce !== false) {
    process.stderr.write(
      `GhostClaw will download ${summary.mebibytes} MiB of pinned proving files.\n`,
    );
  }
  let received = 0;
  let lastPercent = -1;
  const reportProgress = options.onProgress ?? (
    options.announce !== false && process.stderr.isTTY
      ? ({ received: current, total }) => {
          const percent = Math.floor(current * 100 / total);
          if (percent !== lastPercent) {
            lastPercent = percent;
            process.stderr.write(`\rDownloading GhostClaw proving files: ${percent}%`);
            if (percent === 100) process.stderr.write("\n");
          }
        }
      : null
  );
  for (const artifact of PINNED_ARTIFACTS) {
    await downloadArtifact(artifact, artifactCacheDir, options.fetchImpl ?? fetch, (bytes) => {
      received += bytes;
      reportProgress?.({ received, total: ARTIFACT_DOWNLOAD_BYTES, artifact: artifact.name });
    });
  }
  await verifyPinnedArtifacts(artifactCacheDir);
  return { directory: artifactCacheDir, source: "download", downloaded: true };
}

export async function artifactStatus() {
  const offline = configuredArtifactDir();
  const directory = offline ?? artifactCacheDir;
  return {
    directory,
    source: offline ? "offline" : "cache",
    ready: await cacheIsValid(directory),
    download: artifactDownloadSummary(),
  };
}
