import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { checkRepository, forbiddenPath, markdownFindings, textFindings } from "./check-repository.mjs";

function repository(t) {
  const root = mkdtempSync(join(tmpdir(), "ghostclaw-publication-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] }).toString();
  git("init", "--quiet");
  const write = (path, content) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  return { root, git, write };
}

test("publication boundaries reject runtime state but allow public proving parameters", () => {
  for (const path of [".env", ".env.production", "x/.env.local", "config/operator.env", "deployments/merchant.sealed.json", "downloads/release.tar.gz", "customer-deck/brief.pdf", ".ghostclaw/state.json", "x/node_modules/a.js", "vault/wallet.json", "data/notes.sqlite", "job-applications/cv.pdf", "credentials.json"]) {
    assert.equal(forbiddenPath(path), true, path);
  }
  for (const path of [".env.example", "docs/WALLET.md", "deployments/base-sepolia-demo-merchant.json", "public/proving/action.pk", "public/proving/action.vk", "public-parameters/bn254_g1.dat", "third_party/dependencies/source.tar.gz", "scripts/lib/state.mjs"]) {
    assert.equal(forbiddenPath(path), false, path);
  }
});

test("text checks redact findings and allow only known synthetic home fixtures", () => {
  const personal = "person" + "@gmail.com";
  const home = "/" + "Users/example-owner/project";
  const findings = textFindings("README.md", Buffer.from(`${personal}\n${home}`));
  assert.deepEqual(findings.map(({ line, category }) => [line, category]), [[1, "personal-email"], [2, "personal-home-path"]]);
  assert.equal(JSON.stringify(findings).includes(personal), false);
  assert.equal(JSON.stringify(findings).includes(home), false);
  assert.deepEqual(textFindings("site/privacy.html", Buffer.from("ghostclaw@protonmail.com")), []);
  const fixture = "/" + "home/ghostclaw";
  assert.deepEqual(textFindings("scripts/file-security.test.mjs", Buffer.from(fixture)), []);
  assert.equal(textFindings("docs/example.md", Buffer.from(fixture)).length, 1);
  assert.deepEqual(textFindings("ci.yml", Buffer.from("/" + "home/runner/work")), []);
  assert.equal(textFindings("ci.yml", Buffer.from("/" + "home/runner-person/work")).length, 1);
  assert.deepEqual(textFindings(".github/workflows/package-ci.yml", Buffer.from("/" + "home/ghostclaw-package-test/source")), []);
  assert.equal(textFindings("README.md", Buffer.from("/" + "home/ghostclaw-package-test/source")).length, 1);
});

test("environment examples accept placeholders but reject populated values", () => {
  assert.deepEqual(textFindings(".env.example", Buffer.from('TOKEN=\nKEY="<key>"\nOTHER=${TOKEN}\n')), []);
  assert.equal(textFindings(".env.example", Buffer.from("TOKEN=actual-value")).at(0).category, "environment-example-value");
});

test("Markdown links resolve against published paths, including references and encoded spaces", () => {
  const paths = new Set(["README.md", "docs/a b.md", "scripts/run.mjs"]);
  assert.deepEqual(markdownFindings("docs/guide.md", "[home](../README.md#intro)\n[doc](a%20b.md)\n[code](../scripts/)\n[web](https://example.com)", paths), []);
  assert.equal(markdownFindings("README.md", "[missing]: docs/no.md", paths).at(0).category, "missing-local-link");
  assert.equal(markdownFindings("README.md", "[escape](../README.md)", paths).length, 1);
  assert.deepEqual(markdownFindings("README.md", "```md\n[example](missing.md)\n```", paths), []);
  assert.deepEqual(markdownFindings("downloads/old.md", "[old](missing.md)", paths), []);
});

test("index is authoritative even when working files and ignored state differ", (t) => {
  const { root, git, write } = repository(t);
  write(".gitignore", ".env.local\n");
  write("README.md", "Safe staged content\n");
  git("add", ".gitignore", "README.md");
  write("README.md", "person" + "@gmail.com\n");
  write(".env.local", "TOKEN=private-local-value\n");
  assert.deepEqual(checkRepository(root).findings, []);
  git("add", "README.md");
  write("README.md", "Clean working copy\n");
  assert.equal(checkRepository(root).findings.at(0).category, "personal-email");
  git("add", "README.md");
  git("add", "--force", ".env.local");
  assert.equal(checkRepository(root).findings.at(0).category, "private-or-generated-path");
});

test("binary proving files and public parameters do not produce text false positives", (t) => {
  const { root, git, write } = repository(t);
  const binary = Buffer.concat([Buffer.from([0, 255]), Buffer.from("person" + "@gmail.com")]);
  for (const path of ["public/proving/a.pk", "public/proving/a.vk", "public-parameters/srs.dat"]) write(path, binary);
  git("add", ".");
  assert.deepEqual(checkRepository(root).findings, []);
});

test("force-staged custom environment files, sealed wallets, and release downloads are rejected", (t) => {
  const { root, git, write } = repository(t);
  write(".gitignore", "*.env\n*.sealed.json\ndownloads/\n");
  git("add", ".gitignore");
  const paths = ["config/operator.env", "deployments/merchant.sealed.json", "downloads/release.tar.gz"];
  for (const path of paths) write(path, Buffer.from([0, 255]));
  assert.deepEqual(checkRepository(root).findings, []);
  git("add", "--force", ...paths);
  assert.deepEqual(checkRepository(root).findings.map(({ path, category }) => [path, category]),
    paths.map((path) => [path, "private-or-generated-path"]));
});

test("a link to an unstaged file fails until its target enters the index", (t) => {
  const { root, git, write } = repository(t);
  write("README.md", "[guide](docs/guide.md)");
  write("docs/guide.md", "Guide\n");
  git("add", "README.md");
  assert.equal(checkRepository(root).findings.at(0).category, "missing-local-link");
  git("add", "docs/guide.md");
  assert.deepEqual(checkRepository(root).findings, []);
});

test("symlinks and submodules fail without reading their targets", (t) => {
  const { root, git, write } = repository(t);
  write("safe.txt", "safe\n");
  symlinkSync("/missing-private-target", join(root, "link"));
  git("add", "safe.txt", "link");
  const hash = git("hash-object", "safe.txt").trim();
  git("update-index", "--add", "--cacheinfo", `160000,${hash},external`);
  assert.deepEqual(checkRepository(root).findings.map(({ path, category }) => [path, category]), [
    ["external", "unsupported-index-entry"], ["link", "unsupported-index-entry"],
  ]);
});

test("CLI fails with locations and categories without echoing sensitive text", (t) => {
  const { root, git, write } = repository(t);
  const email = "person" + "@gmail.com";
  write("README.md", email);
  git("add", "README.md");
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./check-repository.mjs", import.meta.url))], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /README\.md.*:1: personal-email/);
  assert.equal(result.stderr.includes(email), false);
});
