# Security policy

GhostClaw is experimental software for Base Sepolia and valueless test gUSD. It is not approved for assets with market value.

Internal tests and remediation records are not an independent audit. Review the [security model](docs/SECURITY.md) for assumptions and residual risks.

## Report a vulnerability privately

Contact a repository maintainer through an established private channel. Confirm the channel before sending sensitive details.

Do not publish exploit details in an issue, discussion, pull request, or public chat. Never send private keys, seed phrases, wallet backups, or live credentials.

Include these details when available:

- Affected version or commit.
- Affected component and file locations.
- Reproduction steps using synthetic data or an isolated test environment.
- Expected behavior and observed behavior.
- Security impact and required attacker access.
- Redacted logs or a minimal proof of concept.

The maintainer should coordinate investigation and disclosure with the reporter. This policy does not promise a response deadline or a bounty.

## Scope

Security-sensitive components include circuits, verifiers, contracts, wallets, native prover execution, agent tools, merchant settlement, hosted services, and release tooling.

Reports about dependency vulnerabilities, package integrity, secret exposure, and unintended personal data disclosure are also relevant.

The current package release is `1.5.7`. Include the exact package and native runtime versions in a report. Earlier releases are not declared supported by this policy.

## Handle credentials and private state

Keep service credentials and wallet state outside source control. Use ignored local configuration or the service's secret manager.

Do not attach environment files, authentication headers, credential-bearing RPC URLs, private notes, witnesses, or wallet directories to a report.

If a credential is exposed, revoke or rotate it with the provider. Removing a file does not invalidate an exposed credential.

Avoid testing suspected vulnerabilities against another user's wallet or a hosted service without authorization. Use local fixtures and valueless test assets.

## Operational response

Operators should follow the [incident response guide](docs/INCIDENT_RESPONSE.md). It covers sponsorship shutdown, relay isolation, credential replacement, evidence preservation, and notification.

Keep investigation evidence private. Share only the minimum redacted information needed for coordination.

## Security references

- [Architecture and trust boundaries](docs/ARCHITECTURE.md).
- [Security model and residual risks](docs/SECURITY.md).
- [Versioned remediation record](docs/SECURITY_REMEDIATION.md).
- [Testing and release acceptance](docs/TESTING.md).
- [Reproducible build process](docs/REPRODUCIBLE_BUILDS.md).
- [Contribution requirements](CONTRIBUTING.md).
