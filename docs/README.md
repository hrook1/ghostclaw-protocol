# Documentation

This index describes the GhostClaw `1.5.7` Base Sepolia test release. Test gUSD has no market value.

The active implementation uses gnark PLONK on BN254. The payer and merchant identities remain public. Payment amounts and private note balances remain confidential.

## Start here

| Reader | First document | Next document |
|---|---|---|
| User or integrator | [Project overview](../README.md) | [Public documentation](PUBLIC_DOCUMENTATION.md) |
| Contributor | [Contribution guide](../CONTRIBUTING.md) | [Architecture](ARCHITECTURE.md) |
| Protocol reviewer | [Circuits](CIRCUITS.md) | [Contract](CONTRACT.md) |
| Operator | [Relay](RELAY.md) | [Testing](TESTING.md) |
| Security reviewer | [Security model](SECURITY.md) | [Security remediation record](SECURITY_REMEDIATION.md) |

## Current implementation

These documents explain the source and its current interfaces. Check the exact release and source when reviewing a security claim.

| Document | Scope |
|---|---|
| [Architecture](ARCHITECTURE.md) | Components, payment flow, trust boundaries, and implementation index. |
| [Wallet](WALLET.md) | Encrypted state, key separation, backup, recovery, and wallet operations. |
| [x402](X402.md) | Payment requirements, request binding, settlement verification, and merchant delivery. |
| [Circuits](CIRCUITS.md) | Identity, deposit, payment, and withdrawal proof statements. |
| [Contract](CONTRACT.md) | Pool state, escrow, replay protection, identities, and recovery. |
| [Proving](PROVING.md) | gnark proof generation, pinned public parameters, and artifact checks. |
| [Relay](RELAY.md) | Hosted sponsorship, simulation, call validation, and rate limits. |
| [Package distribution](PACKAGE_DISTRIBUTION.md) | CLI, MCP, library, merchant adapters, and native prover packages. |
| [Public documentation](PUBLIC_DOCUMENTATION.md) | User and integration reference for release `1.5.7`. |

## Development and operations

| Document | Scope |
|---|---|
| [Public source provenance](PUBLIC_SOURCE.md) | Fresh history, preserved release identities, and boundaries of this source publication. |
| [Contribution guide](../CONTRIBUTING.md) | Repository map, setup, change boundaries, and pull requests. |
| [Testing](TESTING.md) | Local checks, native package matrix, and hosted acceptance. |
| [Reproducible builds](REPRODUCIBLE_BUILDS.md) | Pinned build tools, native packages, and proof artifact reproduction. |
| [Merchant configuration](MERCHANT_CONFIGURATION.md) | Move the existing encrypted merchant seed into hosted secret configuration before deployment. |
| [Benchmarking](BENCHMARKING.md) | Commands, environment records, and result interpretation. |
| [Security reporting](../SECURITY.md) | Private vulnerability reporting and disclosure precautions. |
| [Security model](SECURITY.md) | Protected properties, public information, dependencies, and residual risks. |
| [Incident response](INCIDENT_RESPONSE.md) | Operational response to compromise or suspicious activity. |
| [Repository publication review](REPOSITORY_REVIEW.md) | Removed sensitive material, provenance, publication checks, and remaining historical exposure. |
| [Website source](../site/README.md) | Static site, public documentation, and separate hosting boundary. |

Hosted acceptance can create wallets and send sponsored Base Sepolia transactions. It is separate from routine local testing and requires operator approval.

## Dated evidence and release history

These records describe particular versions, deployments, or measured runs. They do not establish current hosted health or independent audit status.

| Document | Context |
|---|---|
| [Base Sepolia](BASE_SEPOLIA.md) | Deployment and network verification record. |
| [Benchmarks](BENCHMARKS.md) | Recorded performance and fee measurements. |
| [Package acceptance](PACKAGE_ACCEPTANCE_TEST.md) | Observed package and hosted payment results. |
| [Security remediation](SECURITY_REMEDIATION.md) | Earlier findings, implemented controls, and remaining review requirements. |
| [Audit file manifest](../AUDIT_FILES.md) | Versioned review inventory; check its stated target before use. |
| [Release 1.5.4](RELEASE_1.5.4.md) | Release-specific changes and constraints. |
| [Release 1.5.5](RELEASE_1.5.5.md) | Release-specific changes and constraints. |
| [Release 1.5.6](RELEASE_1.5.6.md) | Release-specific changes and constraints. |
| [Release 1.5.7](RELEASE_1.5.7.md) | Guided agent welcome and its privacy boundary. |

Version `1.5.7` pins native runtime packages at `1.5.4`. The proving file release remains `1.5.0`. These separate version numbers are intentional.

## Requirements and future work

[V2 security requirements](V2_SECURITY_REQUIREMENTS.md) defines acceptance requirements. A requirement is not evidence that its implementation or deployment passed review.

The published product is a CLI, MCP server, client library, and merchant adapters. A packaged desktop application remains future work.

Historical Groth16, Noir, FFLONK, and Miden work from the surrounding development workspace is outside this repository's active implementation.

Mainnet remains blocked by independent audit, proof-bound session budgets, release-signing operations, and capped-value deployment controls.
