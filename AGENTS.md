# GhostClaw repository guide

This file governs this repository. The surrounding development workspace contains older protocol variants. Its Noir, Circom, FFLONK, and Miden guidance does not describe this release.

## Current implementation

The documented package release is `1.5.7`. It uses the signed `1.5.4` native runtime and the pinned `1.5.0` proving files.

The active proof system is Consensys gnark PLONK on BN254 with the Aztec Ignition universal SRS. GhostClaw runs no project-specific ceremony.

The supported deployment is Base Sepolia with valueless test gUSD. Public payer and merchant identities remain visible. Payment amounts and private note balances remain confidential.

The product includes a CLI, local MCP server, fetch-compatible library, and merchant adapters. A desktop application remains future work.

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/SECURITY.md](docs/SECURITY.md), and [CONTRIBUTING.md](CONTRIBUTING.md) before changing a security boundary.

## Source map

| Path | Responsibility |
|---|---|
| `internal/circuit/`, `internal/model/`, `internal/operation/` | Circuits, tree model, and witness validation. |
| `internal/proving/`, `internal/ignition/`, `cmd/` | Proof generation, SRS validation, native prover, and process limits. |
| `contracts/`, `test/` | Settlement contracts, generated verifiers, and Solidity evidence. |
| `scripts/lib/` | Wallet, policy, settlement, relay, merchant, and package logic. |
| `scripts/ghostclaw.mjs`, `scripts/mcp-server.mjs`, `src/` | Human CLI, restricted agent tools, and public library. |
| `api/` | Hosted service entry points. |
| `packages/` | Merchant adapters and native package definitions. |
| `deployments/`, `public-parameters/`, `public/proving/` | Public deployment evidence, SRS material, and pinned proving files. |
| `site/` | Preserved production website source and its documentation. |
| `docs/` | Current architecture, requirements, and clearly labelled historical evidence. |

## Change boundaries

- Preserve contract selectors, public-input ordering, cryptographic domains, wallet formats, and replay protection.
- Do not mass-rename or relocate `scripts/` or `internal/` for cosmetic consistency.
- Change generated verifiers and proving files through their documented generators. Verify the outputs against reviewed source.
- Do not change hashes or evidence solely to make a failing check pass.
- Preserve real-verifier coverage and negative cases for protocol changes.
- Keep the current production website's content, structure, styling, and interactions unless the task explicitly changes them.
- Keep the agent interface restricted to `ghostclaw_fetch` and `ghostclaw_check_budget` unless an approved interface change requires more.
- Never publish credentials, encrypted wallet backups, note plaintext, witnesses, personal documents, or machine-specific paths.
- Keep private local state and operator configuration in ignored locations. Public manifests must contain only public data.
- Do not claim independent audit, complete anonymity, or production readiness.

## Validation

Use Node.js 22, Go 1.25.12, and Foundry 1.7.1. Install dependencies with `npm ci --ignore-scripts`.

Run `npm run check:repository` and `npm run test:repository` for publication hygiene changes. These checks supplement the application suites.

Use `npm test` for JavaScript changes, `npm run test:go` for Go changes, and `npm run test:contracts` for Solidity changes.

Run `npm run verify:artifacts` after circuit or generated artifact changes. Use `npm run test:full` for complete local release validation.

See [docs/TESTING.md](docs/TESTING.md) for hosted acceptance and native package coverage. Report exactly which checks ran and which remain incomplete.

## External operations

Local tests do not authorize deployment, publication, wallet provisioning, agent configuration changes, or testnet transactions.

Run state-changing hosted or testnet commands only with explicit operator intent. Use valueless assets and the documented approval flags.

Creating a GitHub pull request does not authorize promoting a hosted deployment or publishing npm packages. Keep deployment migration requirements visible in the pull request.
