# GhostClaw

GhostClaw gives autonomous agents confidential x402 payments on Base.

The payer and merchant keep public Base identities. The payment amount and private note balance stay confidential.

Version `1.5.7` is a public Base Sepolia test release. The asset is valueless test gUSD.

[Architecture](docs/ARCHITECTURE.md) · [Documentation](docs/README.md) ·
[Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Website source](site/README.md)

This public repository starts with a reviewed source snapshot and fresh Git history.
It does not import the private predecessor's commits, tags, release archives, or
wallet state. See [public source provenance](docs/PUBLIC_SOURCE.md).

## Repository map

| Area | Responsibility |
| --- | --- |
| [`src/`](src/) | Public JavaScript library |
| [`scripts/`](scripts/) | CLI, wallet runtime, relay logic, tests, and release tools |
| [`packages/`](packages/) | Merchant adapters and native prover package definitions |
| [`cmd/`](cmd/) and [`internal/`](internal/) | Go prover, circuits, cryptography, and operating-system limits |
| [`contracts/`](contracts/) and [`test/`](test/) | Base contracts, generated verifiers, and Solidity tests |
| [`api/`](api/) | Hosted relay, facilitator, and demonstration endpoints |
| [`docs/`](docs/README.md) | Current architecture, integration guides, and dated release evidence |
| [`site/`](site/README.md) | Static website and public documentation source |
| [`deployments/`](deployments/) | Reviewed testnet deployment records |
| [`public/proving/`](public/proving/) | Pinned public proving and verification files |
| [`third_party/`](third_party/) | Pinned upstream source used for reproducible verification |

The JavaScript package, native runtime, and proving files have separate release
versions. Their pins are deliberate. See the [documentation index](docs/README.md).

## Contribute

Use Node.js 22, Go 1.25.12, and Foundry 1.7.1. Install JavaScript dependencies
with `npm ci --ignore-scripts`. Start with [the contributor guide](CONTRIBUTING.md)
for focused tests, publication checks, and the complete verification suite.

The repository and npm packages retain their existing `UNLICENSED` status.
Public package availability does not grant an open-source licence.

## Start the playtest

Install Node.js 22. You do not need Go.

Run:

```sh
npx ghostclaw@1.5.7 start
```

GhostClaw asks for one approval. The command then performs these actions:

1. Select and verify the native prover.
2. Download and verify 12.5 MiB of proving files.
3. Create and encrypt the local wallet.
4. Register the wallet through the sponsored Base Sepolia relay.
5. Create the default payment budget.
6. Connect detected agent clients after a configuration backup.
7. Claim and privately deposit up to 100 valueless test gUSD.
8. Open the connected command-line agent when the terminal is interactive.
9. Show the safe wallet summary and ask before buying the demo report.

Use `--yes` when the human already approved the complete action through an
agent or automation interface:

```sh
npx ghostclaw@1.5.7 start --yes
```

The command prints progress without exposing private wallet data. A safe Linux
user-private group permission is normalized before the prover runs.

Use `npx ghostclaw@1.5.7 start --no-launch` when another process controls the agent client.

Use `npx ghostclaw@1.5.7 init` for wallet setup without automatic test funding.

The wallet uses the operating-system credential store by default. Use a passphrase file on a remote host or in a container:

```sh
chmod 600 /secure/path/ghostclaw-passphrase
npx ghostclaw@1.5.7 start --passphrase-file /secure/path/ghostclaw-passphrase
```

The passphrase file must contain 12 through 1,024 bytes. Keep this file outside the project directory.

Run a check after setup:

```sh
ghostclaw doctor
```

## Get a private test balance

Claim the public test asset:

```sh
ghostclaw claim
```

Move the public amount into a private note:

```sh
ghostclaw deposit --amount 100
```

The deposit amount is public. Later note balances and payment amounts are confidential.

Use `ghostclaw fund` to print the Base address and a terminal QR code. Use this command for direct test-asset funding.

## Connect an agent

Run:

```sh
ghostclaw connect auto
```

GhostClaw detects Claude Code, Codex, and Claude Desktop. It backs up an existing configuration before it writes a change.

The agent receives two MCP tools:

- `ghostclaw_fetch` requests a resource and handles a valid GhostClaw 402 response.
- `ghostclaw_check_budget` reads the approved spending limits.

The MCP server cannot deposit, withdraw, back up, restore, rotate, or revoke the wallet.

For another MCP client, run `ghostclaw connect manual`. Copy the printed configuration into that client.

## Buy the test address report

The hosted demo sells one Base Sepolia address report for 1 private test gUSD.

Ask the connected agent to call `ghostclaw_fetch` with this URL:

```text
https://ghostclaw-confidential-payments.vercel.app/demo/address-report?address=<BASE_ADDRESS>
```

The local runtime checks the quote and budget. It creates the payment proof on
the user machine. The sponsored relay settles the payment on Base Sepolia.

The service returns the report and a durable delivery URL. The delivery URL
does not require a second payment.

The report uses public Base data. It cannot read a GhostClaw private balance or
confidential payment amount.

## Use the library

Install GhostClaw in an agent project:

```sh
npm install ghostclaw
```

Use its fetch-compatible entry point:

```js
import { fetch } from "ghostclaw";

const response = await fetch("https://api.example.com/paid-report");
const report = await response.json();
```

The first request goes to the service. A `402` response starts local validation, proof creation, settlement, and one retry.

The agent does not receive the private note, proof witness, spend key, or private balance.

## Set spending limits

Show the current policy:

```sh
ghostclaw budget
```

Set the main limits:

```sh
ghostclaw budget \
  --max-per-payment 5 \
  --max-per-session 20 \
  --max-per-day 40 \
  --expires-in-days 14
```

Use `--allow` or `--deny` with comma-separated merchant addresses. The human controls these lists.

An out-of-budget request returns `GHOSTCLAW_BUDGET_EXCEEDED` and an approval identifier. Approve that exact request from a terminal:

```sh
ghostclaw approve gca_example_identifier
```

This local policy is for testnet use. A proof-bound session policy is required before a mainnet balance can hold real value.

## Human-only wallet commands

```text
ghostclaw status
ghostclaw status --show-private-balance
ghostclaw fund
ghostclaw claim
ghostclaw deposit --amount 100
ghostclaw withdraw --amount 10
ghostclaw budget
ghostclaw approve <approval-id>
ghostclaw backup --file <path> --input -
ghostclaw verify-backup --file <path> --input -
ghostclaw restore --file <path> --input -
ghostclaw recover
ghostclaw revoke
```

Pass a backup passphrase through standard input. Do not put it in a command argument.

## Merchant middleware

Install the adapter for the merchant framework:

```sh
npm install @ghostclaw/express
```

Initialize a GhostClaw merchant wallet on the service host. Then protect a route:

```js
import { ghostclaw } from "@ghostclaw/express";

app.use("/report", ghostclaw({ price: "1" }));
```

The adapter reads the merchant identity from the local encrypted wallet. It uses the hosted facilitator for public Base checks.

The adapter also decrypts and verifies the received note locally. It releases the route after the note matches the request and confirmed transaction.

Adapters are also available as `@ghostclaw/hono` and `@ghostclaw/next`.

The hosted facilitator route is `/facilitator/verify`. Set
`GHOSTCLAW_FACILITATOR_URL` to use another deployment.

## Prover packages

npm selects one optional native package:

```text
@ghostclaw/prover-darwin-arm64
@ghostclaw/prover-darwin-x64
@ghostclaw/prover-linux-arm64
@ghostclaw/prover-linux-x64
@ghostclaw/prover-win32-x64
```

The package has no postinstall download. First use downloads only the proving files.

The default file source is a versioned Vercel CDN path. The npm package contains
the expected size and SHA-256 hash for each file. A changed CDN file stops the
installation.

For an offline host, place all pinned files in one directory. Then set:

```sh
export GHOSTCLAW_ARTIFACT_DIR=/secure/path/ghostclaw-artifacts
npx ghostclaw init
```

GhostClaw verifies the same embedded hashes in online and offline modes.

## Local files

All mutable state stays under `~/.ghostclaw/` by default:

```text
wallet.enc.json
transaction-key.enc.json
spend-key.enc.json
note-key.enc.json
agent.enc.json
key-storage.json
relay.json
artifacts/v2/1.5.0/
outbox/
```

Set `GHOSTCLAW_HOME` to another absolute directory before wallet creation. Keep the same value in the agent configuration.

## Privacy boundary

Base shows the payer address, merchant address, time, nullifier, commitments, proof, and settlement event.

Base does not show the payment amount or private note balances. The merchant learns its received amount after local note decryption.

The relay sees public prepared transactions and network metadata. It cannot read wallet keys, note plaintext, or private witnesses.

The local host protects the wallet. Malware with user or kernel access can steal local secrets.

## Build and test from source

Contributors need Node.js 22, Go 1.25.12, and Foundry 1.7.1.

```sh
npm ci --ignore-scripts
npm run test:full
```

Build a platform package:

```sh
npm run build:native -- darwin arm64
```

See `docs/PACKAGE_DISTRIBUTION.md` for the package layout and release gates.
See `docs/PACKAGE_ACCEPTANCE_TEST.md` for the observed package and Base Sepolia result.
See `docs/TESTING.md` for each local, package, and hosted acceptance check.

## Release status

This tree derives from the `1.5.7` Base Sepolia source, with repository hardening
and compatible dependency updates. It is not a new npm release or a byte-identical
copy of the original signed release tree.

Existing signed tags and release attestations belong to the private predecessor.
They are not recreated here. Package, native runtime, and proving-file pins stay
unchanged. Future releases require separately approved signing and publishing setup.

Mainnet remains blocked by an independent audit, proof-bound session budgets, release-signing operations, and capped-value deployment controls.
