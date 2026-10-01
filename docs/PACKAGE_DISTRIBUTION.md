# Package distribution

## Status

Version `1.5.7` is the public npm package release for Base Sepolia.

This package uses the pinned `1.5.0` proving-file set. Package fixes can ship
without changing circuits or invalidating a verified proving-file cache.

The release unit is one npm package with a CLI, an MCP server, and a library entry point.

```text
npx ghostclaw start
npx ghostclaw init
npx ghostclaw mcp
import { fetch } from "ghostclaw"
```

The package does not use a browser wallet or desktop shell.

## User path

### 1. Install

The user needs Node.js 22 or later.

```sh
npx ghostclaw start
```

npm installs one native prover package for the current operating system and CPU.
Version `1.5.7` pins the signed `1.5.4` native runtime. The native source did not
change in this JavaScript release.

No package uses a postinstall script. npm installation does not create a wallet or contact Base.

`start` asks for one human approval. It creates the wallet, connects detected
agents, claims valueless test gUSD, and deposits the test asset into the private
pool. A rerun keeps existing private test funds. An interactive run then opens
Claude Code or Codex. Use `--no-launch` to keep the connected client closed.

### 2. Verify proving files

The first `init` downloads 12.5 MiB of proving files. The package contains the expected name, size, and SHA-256 hash for each file.

The download server cannot change those hashes. A changed file stops initialization.

The default source is `/proving/1.5.0/` on the GhostClaw Vercel deployment.
Vercel serves the versioned files with an immutable cache policy. CI checks the
committed files against the package manifest.

The release workflow packages these committed files. It does not read ignored
developer artifact directories.

Set `GHOSTCLAW_ARTIFACT_DIR` for an offline installation. The value must be an absolute path.

### 3. Create the wallet

`init` creates three local key domains:

- A secp256k1 Base transaction key.
- A GhostClaw spend key.
- An X25519 note encryption key.

The command encrypts each domain separately. The operating-system credential store protects the encryption keys.

Use `--passphrase-file` when a credential store is unavailable. The passphrase path is stored in the local MCP configuration. The passphrase content is not stored there.

### 4. Register on Base Sepolia

The local prover creates the identity proof. The local Base key signs the checked sponsored operation.

The hosted relay sends the operation to Alchemy. The relay applies its contract allowlist, rate limits, callback authentication, and independent simulation.

### 5. Set the budget

The default test policy permits:

| Limit | Value |
|---|---:|
| Each payment | 10 gUSD |
| Each 8-hour session | 25 gUSD |
| Each UTC day | 50 gUSD |
| Policy lifetime | 30 days |

The human changes these values with `ghostclaw budget`.

### 6. Connect an agent

`init` detects supported agent clients. It asks before it writes a configuration.

The writer supports:

- Claude Code project configuration.
- Claude Code user configuration.
- Claude Desktop configuration.
- Codex configuration.
- A JSON block for another client.

The writer creates a backup before each change.

An interactive `start` opens one connected client. GhostClaw prefers Claude Code,
then Codex, then Claude Desktop. A non-interactive process never opens a client.

Claude Code and Codex receive one guided test prompt. The agent reads the public
spending policy, shows the public account and network, and explains the demo.
It waits for explicit approval before it buys the address report. The prompt
does not contain the private balance, private note data, or a wallet secret.

## Package map

```text
ghostclaw
├── scripts/ghostclaw.mjs          CLI
├── scripts/mcp-server.mjs         stdio MCP server
├── scripts/lib/                   wallet and payment runtime
├── src/index.mjs                  fetch-compatible library
└── packages/merchant-core/        merchant protocol core

@ghostclaw/prover-<os>-<cpu>
├── bin/ghostclaw-prover
├── bin/ghostclaw-prover-limiter
└── checksums.json

@ghostclaw/express
@ghostclaw/hono
@ghostclaw/next
```

## Native package selection

The root package lists all native packages under `optionalDependencies`.

Each native package declares one `os` value and one `cpu` value. npm installs the matching package and skips the others.

The runtime resolves the exact expected package name. It checks both binary hashes before execution.

Source checkouts can build the prover with Go. Installed npm packages do not contain Go source and cannot use that fallback.

## Proving file cache

The default cache path is:

```text
~/.ghostclaw/artifacts/v2/1.5.0/
```

The version is part of the path. A package update cannot reuse another version without a full verification.

The installer uses an exclusive temporary file. It checks the received byte count and hash before an atomic rename.

Files must belong to the current user. Files must not be symbolic links or writable by another user.
On Linux, npm can add group write permission when it extracts a package. GhostClaw removes this permission only for the current user's private primary group. It then verifies the file hash. It rejects shared groups and world write permission.
Vercel can own function files with a deployment user. GhostClaw accepts these files only inside the loaded function bundle. It uses `LAMBDA_TASK_ROOT` when Vercel supplies it. The file and every parent directory must have the same deployment owner. They must not be symbolic links. They must not allow group or world writes.

## Wallet storage

The default data path is `~/.ghostclaw/`.

The wallet uses AES-256-GCM. It derives separate keys for the transaction, spend, note, metadata, and agent-policy domains.

The passphrase mode uses scrypt with these parameters:

```text
N = 131072
r = 8
p = 1
```

The runtime sets directory mode `0700` and file mode `0600`. It rejects unsafe ownership, permissions, symbolic links, and incomplete key sets.

## Agent payment path

The MCP server exposes these tools:

```text
ghostclaw_fetch
ghostclaw_check_budget
```

`ghostclaw_fetch` uses this sequence:

1. Send the original HTTP request.
2. Return a normal response when the status is not `402`.
3. Decode the `PAYMENT-REQUIRED` header.
4. Require the GhostClaw scheme, network, token, pool, merchant, note key, and TLS origin.
5. Bind a fingerprint to the URL, method, headers, body hash, and requirement.
6. Check the human budget before proof creation.
7. Create and verify the proof on the local machine.
8. Settle through the sponsored relay.
9. Store the confirmed settlement before the resource retry.
10. Retry the exact request with `PAYMENT-SIGNATURE`.
11. Return the resource.

The settlement journal prevents a second payment after a retry network failure.

The merchant import is idempotent for the same transaction, payment intent,
salt, and request digest. A resource retry does not import the note twice.

The client rejects redirects after payment. It also rejects a repeated `402` response.

## Budget controls

The local policy checks:

- Maximum payment amount.
- Maximum 8-hour session total.
- Maximum UTC-day total.
- Merchant allowlist.
- Merchant denylist.
- Policy expiry.

An out-of-policy request creates a random approval identifier. `ghostclaw approve <id>` approves only the exact request fingerprint.

The local policy protects normal agent operation. It does not stop malware that steals an unlocked wallet. A proof-bound session policy is required before mainnet.

## MCP boundary

The MCP child can start only the MCP server and the internal payment command.

The MCP response omits:

- Private balances.
- Note plaintext.
- Proof witnesses.
- Spend keys.
- Note keys.
- Wallet file paths.

Human operations remain in the CLI. This includes deposits, withdrawals, backups, restores, account rotation, and emergency revocation.

## Merchant path

The framework adapter creates a deterministic GhostClaw x402 requirement. It sends a submitted payment response to the hosted facilitator.

The facilitator checks the public Base transaction, receipt, settlement call, event, commitments, root, nullifier, and payment intent.

The merchant runtime performs the private check. It decrypts the note and binds it to the exact requirement. It imports the note before it releases the resource.

A custom `onSettlement` callback must preserve the same idempotent behavior.

The hosted facilitator cannot read the amount or resource URL. It receives the
public merchant address, encrypted payment response, and public Base evidence.

The Express integration is:

```js
import { ghostclaw } from "@ghostclaw/express";

app.use("/report", ghostclaw({ price: "1" }));
```

Hono and Next.js use the same local wallet and hosted facilitator model.

## Hosted test service

The Base Sepolia demo endpoint is:

```text
https://ghostclaw-confidential-payments.vercel.app/demo/address-report?address=<BASE_ADDRESS>
```

The service quotes 1 test gUSD. It imports the encrypted merchant note before
it creates a report.

The hosted merchant bundles the Linux native note inspector. The inspector
checks the received note without downloading proving artifacts. All payment
proof creation stays on the payer machine.

The demo merchant state uses AES-256-GCM. Vercel holds one separate encryption
secret. Redis holds only authenticated ciphertext and public report records.

A Redis lock makes note import atomic across serverless instances. A repeated
paid request returns the existing job. It does not import the note twice.

The report job stays available for seven days. The returned delivery URL uses
an unguessable HMAC job identifier. The report contains public Base data only.

## Standard x402 result

A standard `exact` settlement transfers a public token amount. It reveals the payer, merchant, asset, amount, and transaction time.

This release does not treat `exact` as confidential-compatible. A standard endpoint must add the GhostClaw scheme to preserve amount privacy.

The root library exposes `inspectStandardX402Requirement` through `ghostclaw/merchant` for integration tests.

Inspect a live unmodified endpoint without paying it:

```sh
npm run spike:standard-x402 -- https://merchant.example/paid-resource
```

## Release process

The package workflow is manual. It performs these actions:

1. Require one version in `VERSION`, `package.json`, and the workflow input.
2. Require a signed `v<version>` tag from `release/allowed_signers`.
3. Run JavaScript and Go checks.
4. Build native packages on each matching GitHub runner.
5. Pack each native package on its build runner.
6. Keep downloaded native archives separate from JavaScript archives.
7. Check the committed CDN files against the pinned package hashes.
8. Attach the same proving files to the signed source release.
9. Publish native packages before the root package.
10. Publish the merchant adapters.
11. Publish the same CI-built tarballs to npm through trusted publishing.

The workflow requires npm trusted publishing and the `npm-release` environment.
Existing packages were released from the private predecessor. They do not gain
public registry provenance when this snapshot becomes public. The workflow signs
release files through Sigstore with the GitHub Actions OIDC identity. Configure
the new repository's signing, trusted publisher, release environment, and public
provenance before any future release. These settings are not inherited or enabled
by copying the workflow. See [public source provenance](PUBLIC_SOURCE.md).

The workflow can retry an interrupted release. It replaces matching GitHub
release files and skips each npm version that is already public.

Run `npm run test:full` before a release tag. This command checks JavaScript,
package contents, native runtime files, Go code, Solidity contracts, known
vulnerabilities, and reproducible proving artifacts.

Deploy an immutable Vercel Preview from the exact release commit. Run the
`Hosted acceptance` workflow against that Preview. The workflow creates a
temporary wallet, makes one Base Sepolia payment, retrieves the durable report,
and checks that a delivery retry cannot charge twice.

Promote the same Vercel deployment without a rebuild. Run the read-only and
paid acceptance checks against Production. Publish npm packages only after both
Production checks pass.

## Release gates

Complete these external actions before publication:

- Confirm maintainer publish rights for the existing `ghostclaw` package and `@ghostclaw` scoped packages.
- Configure npm trusted publishing with required two-factor authentication.
- Deploy the versioned proving files before npm publication.
- Download and verify every live CDN file before npm publication.
- Sign or attest every native package from CI.
- Pass the CI clean installation test on macOS ARM64, macOS x64, Linux ARM64, Linux x64, and Windows x64.
- Pass the Linux private-group permission test for the installed native runtime.
- Pass the Vercel native-inspector startup test without `LAMBDA_TASK_ROOT`.
- Deploy `/facilitator/verify` and `/demo/address-report` with shared rate limits.
- Pass one paid hosted report flow on the immutable Vercel Preview.
- Promote the tested Preview without a rebuild.
- Pass the read-only and paid hosted checks on Production.

## Mainnet gates

The following work remains outside the testnet package release:

- Proof-bound session budgets.
- Independent protocol and package audit.
- Audit remediation and signed evidence.
- Mainnet contract deployment.
- Capped real-value limits.
- Incident response and sponsorship shutdown drills.
