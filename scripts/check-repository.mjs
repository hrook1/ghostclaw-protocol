import { execFileSync } from "node:child_process";
import { posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// This complements Gitleaks. It checks publication boundaries, not secret entropy.
const privateDirectories = new Set([
  "node_modules", ".ghostclaw", ".operator", ".handoff", ".vercel", ".git",
  ".runtime", ".vault", "vault", ".cache", "cache", ".npm", ".next",
  "foundry-cache", "foundry-out", "__pycache__", ".venv", "job-applications",
  "customer-deck", "downloads",
]);
const publicContact = "ghostclaw@protonmail.com";
const homeFixtures = new Set(["ghostclaw", "another"].map((user) => "/" + `home/${user}`));
const fixtureWorkflows = new Set([".github/workflows/package-ci.yml", ".github/workflows/publish-packages.yml"]);

export function forbiddenPath(path) {
  const parts = path.toLowerCase().split("/");
  const name = parts.at(-1);
  return parts.some((part) => privateDirectories.has(part))
    || (name.startsWith(".env") && !name.endsWith(".example"))
    || /(?:\.(?:db|sqlite3?|log|pem|key|p12|pfx|vault|sealed\.json)|\.ds_store)$/.test(name)
    || (name.endsWith(".env") && !name.endsWith(".example"))
    || /^(?:id_rsa|id_ed25519)(?:\.|$)/.test(name)
    || /^(?:wallet|vault|credentials)(?:\.(?:json|bak|enc|backup)|$)/.test(name);
}

export function textFindings(path, bytes) {
  if (bytes.includes(0)) return [];
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return []; }
  const findings = [];
  const add = (line, category) => findings.push({ path, line, category });
  text.split("\n").forEach((line, index) => {
    const homes = line.match(/\/(?:Users|home)\/[A-Za-z0-9._-]+/g) ?? [];
    if (homes.some((home) => home !== "/" + "home/runner"
      && !(path === "scripts/file-security.test.mjs" && homeFixtures.has(home))
      && !(fixtureWorkflows.has(path) && home === "/" + "home/ghostclaw-package-test"))) {
      add(index + 1, "personal-home-path");
    }
    const emails = line.match(/[A-Z0-9._%+-]+@(?:gmail|googlemail|icloud|me|mac|hotmail|outlook|live|yahoo|protonmail|proton|aol|msn)\.[A-Z.]+|[A-Z0-9._%+-]+@pm\.me\b/gi) ?? [];
    if (emails.some((email) => email.toLowerCase() !== publicContact)) add(index + 1, "personal-email");
    if (posix.basename(path).startsWith(".env") && path.endsWith(".example")) {
      const assignment = line.match(/^\s*(?:export\s+)?[A-Z_][A-Z0-9_]*\s*=\s*(.*?)\s*$/i);
      const value = assignment?.[1].replace(/^(["'])(.*)\1$/, "$2");
      if (value && !/^(?:<[^>]+>|(?:YOUR|REPLACE|EXAMPLE|CHANGEME|PLACEHOLDER|TODO)[A-Z0-9_-]*|\$\{[A-Z0-9_]+\})$/i.test(value)) {
        add(index + 1, "environment-example-value");
      }
    }
  });
  return findings;
}

export function markdownFindings(path, text, paths) {
  // Signed release evidence and third-party documentation preserve historical links.
  if (!/^(?:[^/]+\.md|(?:docs|site)\/.*\.md)$/i.test(path)) return [];
  const findings = [];
  let fence = null;
  text.split("\n").forEach((line, index) => {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      return;
    }
    if (fence) return;
    const links = [...line.matchAll(/\]\(\s*(?:<([^>]+)>|([^\s)]+))/g)].map((match) => match[1] ?? match[2]);
    const reference = line.match(/^\s{0,3}\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))/);
    if (reference) links.push(reference[1] ?? reference[2]);
    for (const link of links) {
      if (/^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(link)) continue;
      let destination;
      try { destination = decodeURIComponent(link.split(/[?#]/)[0]); }
      catch { findings.push({ path, line: index + 1, category: "invalid-local-link" }); continue; }
      const target = posix.normalize(destination.startsWith("/")
        ? destination.slice(1) : posix.join(posix.dirname(path), destination)).replace(/\/$/, "");
      if (target === "." || paths.has(target) || [...paths].some((file) => file.startsWith(target + "/"))) continue;
      findings.push({ path, line: index + 1, category: "missing-local-link" });
    }
  });
  return findings;
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

export function checkRepository(cwd = process.cwd()) {
  const root = git(cwd, ["rev-parse", "--show-toplevel"]).toString().trim();
  const entries = git(root, ["ls-files", "--stage", "-z"]).toString().split("\0").filter(Boolean).map((entry) => {
    const [, mode, hash, stage, path] = entry.match(/^(\d+) ([a-f0-9]+) (\d)\t([\s\S]+)$/);
    return { mode, hash, stage, path };
  });
  const paths = new Set(entries.filter((entry) => entry.stage === "0").map((entry) => entry.path));
  const findings = [];
  for (const { mode, hash, stage, path } of entries) {
    if (stage !== "0" || !["100644", "100755"].includes(mode)) {
      findings.push({ path, line: 1, category: "unsupported-index-entry" });
      continue;
    }
    if (forbiddenPath(path)) findings.push({ path, line: 1, category: "private-or-generated-path" });
    // Object IDs bind the check to the index even when working files differ.
    const bytes = git(root, ["cat-file", "blob", hash]);
    findings.push(...textFindings(path, bytes));
    if (path.endsWith(".md")) findings.push(...markdownFindings(path, bytes.toString("utf8"), paths));
  }
  return { checked: entries.length, findings };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { checked, findings } = checkRepository();
    for (const { path, line, category } of findings) console.error(`${JSON.stringify(path)}:${line}: ${category}`);
    console.log(`Repository publication check: ${checked} indexed files, ${findings.length} findings.`);
    process.exitCode = findings.length ? 1 : 0;
  } catch {
    console.error("Repository publication check failed: Git index could not be inspected.");
    process.exitCode = 1;
  }
}
