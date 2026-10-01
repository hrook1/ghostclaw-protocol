# Contributing

GhostClaw is a Base Sepolia test release. Use valueless test gUSD only.

Read the [architecture](docs/ARCHITECTURE.md) and [security model](docs/SECURITY.md) before changing payment, wallet, proof, or relay code.

## Repository map

| Path | Responsibility |
|---|---|
| `src/` | Public fetch-compatible client library. |
| `scripts/ghostclaw.mjs` | Human CLI. |
| `scripts/mcp-server.mjs` | Agent tools for payment requests and budget inspection. |
| `scripts/lib/` | Wallet, policy, transaction, relay, and merchant implementation. |
| `api/` | Hosted service entry points. |
| `packages/` | Merchant adapters and platform-specific native package definitions. |
| `cmd/` | Native prover, process limiter, and Solidity hash generator. |
| `internal/` | Go circuits, model, witness checks, proving, and public parameter loading. |
| `contracts/` | Pool, test token, generated verifiers, and contract test helpers. |
| `test/` | Solidity tests and public test fixtures. |
| `deployments/` | Public deployment manifests and verification evidence. |
| `public-parameters/` | Pinned universal SRS material and provenance. |
| `public/proving/` | Versioned, package-pinned public proving files. |
| `third_party/` | Pinned dependency source and provenance. |
| `release/` | Release tooling and verification material. |
| `docs/` | [Documentation index](docs/README.md). |

## Set up a checkout

Use Node.js 22, Go 1.25.12, and Foundry 1.7.1. Install the locked JavaScript dependencies:

```sh
npm ci --ignore-scripts
```

Use a separate development wallet when an integration needs wallet state. Do not copy a personal wallet or service credentials into the checkout.

The default wallet directory is outside the repository at `~/.ghostclaw/`. Set `GHOSTCLAW_HOME` to an isolated absolute path for an approved integration run.

## Run checks

Choose checks for the changed surface. Run commands from the repository root.

| Changed surface | Check |
|---|---|
| Any staged change | `npm run check:repository` and `npm run check:secrets` |
| Publication guard | `npm run test:repository` |
| Website documentation | `npm run site:docs` and inspect the generated pages |
| JavaScript client, CLI, wallet, relay, or merchant adapter | `npm test` |
| Package contents or public exports | `npm run test:release` |
| Go circuits, prover, or native runtime | `npm run test:go` |
| Solidity contracts | `npm run test:contracts` |
| Pinned public proving files | `npm run verify:public-artifacts` |
| Circuit or generated artifact changes | `npm run verify:artifacts` |
| Dependency changes | `npm run test:security` |

The complete local release gate is:

```sh
npm run test:full
```

This gate includes dependency vulnerability checks and proof artifact reproduction. Dependency downloads and vulnerability databases can require network access. It does not authorize deployment.

Native-runtime tests need an available platform package. CI builds its native package before running the JavaScript suite. Build one locally when necessary:

```sh
npm run build:native -- <platform> <architecture>
```

See [reproducible builds](docs/REPRODUCIBLE_BUILDS.md) for supported targets and build constraints. See [testing](docs/TESTING.md) for the full acceptance process.

## Keep hosted operations explicit

`npm run verify:hosted -- --relay https://DEPLOYMENT.example` performs read-only hosted checks. Use an approved deployment origin.

Paid acceptance, guided-start acceptance, deployment, merchant provisioning, and wallet commands can change state. They can use credentials and spend valueless test tokens or sponsorship allowance.

Run those operations only with explicit operator approval. Do not run them as ordinary local tests. Do not publish npm packages or promote a deployment from a pull request.

## Preserve protocol and privacy boundaries

- Keep private keys, note plaintext, proof witnesses, wallet backups, and service credentials out of source control and logs.
- Keep `ghostclaw_fetch` and `ghostclaw_check_budget` as the agent-facing tool boundary unless an approved interface change requires more.
- Preserve public-input ordering, domain separation, contract selectors, serialized wallet formats, and replay protections.
- Document a migration when a change affects an existing protocol or storage interface.
- Regenerate generated verifiers and proof artifacts from reviewed source. Do not repair their hashes to conceal unexplained differences.
- Keep real-verifier tests and negative cases when changing cryptographic or settlement behavior.
- Preserve pinned third-party source, licences, checksums, and provenance.
- Describe public payer and merchant identities accurately. Do not claim identity anonymity or production readiness.

Use [private security reporting](SECURITY.md) for vulnerabilities. Do not place exploit details or credentials in a public issue.

## Prepare a pull request

Keep each change focused. Explain its purpose, resulting behavior, validation, and any remaining limitation.

Update affected documentation when behavior changes. Label dated evidence and future requirements clearly. Do not present a historical test result as fresh verification.

Review the staged files before committing:

```sh
git diff --check
git diff --cached --stat
git diff --cached
```

Inspect new files and generated content for secrets, personal information, local paths, wallet data, and unintended build output. Ignored files still require care when copying or packaging.

Install Gitleaks `8.30.1` for `npm run check:secrets`, or set `GITLEAKS_BIN` to
its executable. CI verifies the scanner archive against a pinned SHA-256.
The guard and scanner inspect the Git index. Stage the intended files before
running them; unstaged edits are not part of the result.

The scanner includes nested source archives. Keep fixture exceptions narrow and
documented in `.gitleaks.toml`. Never suppress a real credential finding.
The [repository review](docs/REPOSITORY_REVIEW.md) records historical findings.

Run the applicable checks before requesting review. Report failures and checks that were not run. Passing tests do not replace an independent security audit.
