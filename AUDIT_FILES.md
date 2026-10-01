# Audit file manifest

## Audit target

This is the historical `1.5.0` inventory. The repository cleanup removes private
merchant seed material and adds publication checks. Use the current Git tree and
[repository review](docs/REPOSITORY_REVIEW.md) for those changes.

Audit GhostClaw Confidential Payments release `1.5.0` as one system. The target
includes circuits, generated proof artifacts, contracts, local wallet, sponsored
relay, x402 settlement checks, deployment evidence, and release tooling.

The Base Sepolia deployment uses valueless test gUSD. A successful audit does
not convert this testnet deployment into a production asset pool.

The auditor must compare source files with the final signed Git tag. The audit
bundle also contains deployment and release evidence that the operator creates
after the source tag.

## Project and build files

```text
VERSION
package.json
package-lock.json
go.mod
go.sum
foundry.toml
vercel.json
.vercelignore
.gitignore
.gitattributes
README.md
.github/workflows/package-ci.yml
.github/workflows/hosted-acceptance.yml
.github/workflows/publish-packages.yml
```

## Circuit and proof source

```text
internal/circuit/v2.go
internal/circuit/v2_test.go
internal/circuit/circuits.go
internal/model/hash.go
internal/model/poseidon.go
internal/model/poseidon_test.go
internal/model/tree.go
internal/model/tree_test.go
internal/operation/v2.go
internal/operation/v2_test.go
internal/operation/operation.go
internal/proving/system.go
internal/ignition/srs.go
internal/scenario/scenario.go
internal/scenario/v2.go
internal/scenario/v2_test.go
cmd/ghostclaw-prover/main.go
cmd/ghostclaw-prover-limiter/main.go
cmd/ghostclaw-prover-limiter/limit_darwin.go
cmd/ghostclaw-prover-limiter/limit_linux.go
cmd/ghostclaw-prover-limiter/limit_windows.go
cmd/ghostclaw-prover-limiter/limit_unsupported.go
cmd/poseidon2-solidity/main.go
```

## Public parameters and generated artifacts

```text
public-parameters/README.md
public-parameters/bn254_g1.dat
artifacts/manifest.json
artifacts/identity.ccs
artifacts/identity.pk
artifacts/identity.vk
artifacts/deposit.ccs
artifacts/deposit.pk
artifacts/deposit.vk
artifacts/spend.ccs
artifacts/spend.pk
artifacts/spend.vk
artifacts/withdraw.ccs
artifacts/withdraw.pk
artifacts/withdraw.vk
```

The auditor must regenerate every artifact from the fixed source and SRS. The
regenerated hashes must match the pinned values in
`scripts/lib/artifact-manifest.mjs`.

The Vercel deployment also serves these exact files:

```text
public/proving/1.5.0/
```

Run `npm run verify:public-artifacts` before the source tag.

## Contracts

```text
contracts/GhostClawTestUSDV2.sol
contracts/GhostClawGnarkPlonkPoolV2.sol
contracts/generated/GhostClawGnarkIdentityVerifierV2.sol
contracts/generated/GhostClawGnarkDepositVerifierV2.sol
contracts/generated/GhostClawGnarkSpendVerifierV2.sol
contracts/generated/GhostClawGnarkWithdrawVerifierV2.sol
contracts/generated/GhostClawPoseidon2BN254.sol
contracts/test/MockGUSD.sol
contracts/test/MockGnarkVerifier.sol
```

## Contract tests

```text
test/GhostClawTestUSDV2.t.sol
test/GhostClawGnarkVerifierV2.t.sol
test/GhostClawGnarkPlonkPoolV2.t.sol
test/GhostClawGnarkPlonkPoolV2Real.t.sol
test/Poseidon2BN254.t.sol
test/fixtures/v2-local-scenario.json
```

## Local wallet and transaction adapter

```text
scripts/ghostclaw.mjs
scripts/install.sh
scripts/mcp-server.mjs
src/index.mjs
scripts/lib/agent-policy.mjs
scripts/lib/alchemy-adapter.mjs
scripts/lib/artifact-installer.mjs
scripts/lib/artifact-manifest.mjs
scripts/lib/connect-client.mjs
scripts/lib/demo-address-report.mjs
scripts/lib/demo-merchant-store.mjs
scripts/lib/doctor.mjs
scripts/lib/file-security.mjs
scripts/lib/local-runtime.mjs
scripts/lib/merchant-wallet.mjs
scripts/lib/native-prover.mjs
scripts/lib/onboarding.mjs
scripts/lib/paths.mjs
scripts/lib/playtest-credit.mjs
scripts/lib/protocol.mjs
scripts/lib/prover.mjs
scripts/lib/redact-fatal-error.ts
scripts/lib/sealed-json.mjs
scripts/lib/settlement.mjs
scripts/lib/state.mjs
scripts/lib/transaction-signer.mjs
scripts/lib/tree-sync.mjs
scripts/lib/upstash-store.mjs
scripts/lib/x402-client.mjs
packages/merchant-core/index.mjs
packages/express/index.mjs
packages/hono/index.mjs
packages/next/index.mjs
packages/prover-darwin-arm64/package.json
packages/prover-darwin-x64/package.json
packages/prover-linux-arm64/package.json
packages/prover-linux-x64/package.json
packages/prover-win32-x64/package.json
```

## Relay and sponsorship

```text
api/health.mjs
api/rpc.mjs
api/alchemy-sponsor.mjs
api/facilitator-verify.mjs
api/demo-address-report.mjs
api/note-tree.mjs
scripts/lib/note-tree-service.mjs
scripts/lib/vercel-note-tree.mjs
scripts/relay.mjs
scripts/sponsorship-monitor.mjs
scripts/lib/relay-policy.mjs
scripts/lib/relay-rate-limiter.mjs
scripts/lib/relay-server.mjs
scripts/lib/facilitator-server.mjs
scripts/lib/sponsor-simulation.mjs
scripts/lib/sponsorship-monitor.mjs
scripts/lib/sponsorship-policy.mjs
scripts/lib/vercel-relay.mjs
scripts/lib/vercel-facilitator.mjs
scripts/lib/vercel-demo-address-report.mjs
```

## JavaScript tests

```text
scripts/alchemy-adapter.test.mjs
scripts/agent-policy.test.mjs
scripts/artifact-installer.test.mjs
scripts/cli-ux.test.mjs
scripts/connect-client.test.mjs
scripts/demo-address-report.test.mjs
scripts/facilitator-server.test.mjs
scripts/file-security.test.mjs
scripts/hosted-runtime.test.mjs
scripts/inspect-standard-x402.mjs
scripts/merchant-wallet.test.mjs
scripts/native-prover.test.mjs
scripts/note-tree-service.test.mjs
scripts/onboarding.test.mjs
scripts/package-layout.test.mjs
scripts/playtest-credit.test.mjs
scripts/privacy.test.mjs
scripts/prover-integrity.test.mjs
scripts/prover-runtime.test.mjs
scripts/relay-policy.test.mjs
scripts/relay-rate-limiter.test.mjs
scripts/relay-server.test.mjs
scripts/settlement.test.mjs
scripts/sponsor-gate.test.mjs
scripts/sponsorship-monitor.test.mjs
scripts/state.test.mjs
scripts/transaction-signer.test.mjs
scripts/tree-sync.test.mjs
scripts/vercel-relay.test.mjs
src/fetch.test.mjs
packages/merchant-core/merchant-core.test.mjs
```

## Deployment tools

```text
scripts/lib/alchemy-deployment.ts
scripts/deployment-plan.ts
scripts/preflight-base-sepolia.ts
scripts/deploy-base-sepolia.ts
scripts/recover-base-sepolia-v2-deployment.ts
scripts/verify-base-sepolia.ts
scripts/verify-live-demo.mjs
scripts/verify-hosted-payment.mjs
scripts/verify-guided-start.mjs
scripts/verify-reproducible-artifacts.sh
scripts/verify-alchemy-delegation.sh
scripts/verify-alchemy-runtime.mjs
scripts/verify-redis-limits.mjs
scripts/verify-undelegation.mjs
scripts/verify-public-artifacts.mjs
scripts/provision-demo-merchant.mjs
scripts/e2e-base-sepolia.ts
```

## Deployment evidence

```text
deployments/base-sepolia-v2.json
deployments/base-sepolia-v2-preflight.json
deployments/base-sepolia-v2-relay-verified.json
deployments/base-sepolia-v2-proofs.json
deployments/base-sepolia-v2-verified.json
deployments/base-sepolia-v2-undelegation.json
deployments/base-sepolia-demo-merchant.json
benchmark-results/base-sepolia-v2-e2e.json
benchmark-results/native-proving.json
audit-materials/alchemy/emergency-exit-policy-redacted.json
audit-materials/alchemy/policy-shutdown-drill-redacted.json
audit-materials/alchemy/sample-sponsorship-records-redacted.json
audit-materials/vercel/sample-relay-logs-redacted.json
audit-materials/release/wallet-backup-restore.json
```

Some live files appear only after the final acceptance test. The signed release
must include each completed evidence file.

## Release tooling

```text
scripts/build-playtest-bundle.sh
scripts/build-native-package.mjs
scripts/build-packaged-runtime.sh
scripts/generate-release-metadata.mjs
scripts/benchmark-local.sh
scripts/stage-artifacts.mjs
scripts/test-native-install.mjs
release/ghostclaw-release-cosign.pub
release/allowed_signers
```

The package release output must contain:

```text
ghostclaw-1.5.0.tgz
ghostclaw-prover-darwin-arm64-1.5.0.tgz
ghostclaw-prover-darwin-x64-1.5.0.tgz
ghostclaw-prover-linux-arm64-1.5.0.tgz
ghostclaw-prover-linux-x64-1.5.0.tgz
ghostclaw-prover-win32-x64-1.5.0.tgz
ghostclaw-express-1.5.0.tgz
ghostclaw-hono-1.5.0.tgz
ghostclaw-next-1.5.0.tgz
ghostclaw-v2-*.{json,ccs,pk,vk,dat}
```

## Third-party Alchemy source

```text
third_party/alchemy-modular-account-v2/README.md
third_party/alchemy-modular-account-v2/source-v2.0.0.tar.gz
third_party/alchemy-modular-account-v2/source-v2.0.0.tar.gz.sha256
third_party/alchemy-modular-account-v2/submodules.sha256
third_party/alchemy-modular-account-v2/submodules/*.tar.gz
third_party/alchemy-modular-account-v2/submodules/webauthn-sol/*.tar.gz
third_party/alchemy-modular-account-v2/dependencies.sha256
third_party/alchemy-modular-account-v2/dependencies/*.tar.gz
```

The auditor must compare the pinned deployed runtime with the audited source and
enabled module configuration.

## Technical documents

```text
docs/ARCHITECTURE.md
docs/BASE_SEPOLIA.md
docs/BENCHMARKING.md
docs/BENCHMARKS.md
docs/CIRCUITS.md
docs/CONTRACT.md
docs/INCIDENT_RESPONSE.md
docs/PACKAGE_ACCEPTANCE_TEST.md
docs/PACKAGE_DISTRIBUTION.md
docs/PROVING.md
docs/REPRODUCIBLE_BUILDS.md
docs/RELEASE_1.5.4.md
docs/RELEASE_1.5.5.md
docs/RELEASE_1.5.6.md
docs/RELEASE_1.5.7.md
docs/RELAY.md
docs/SECURITY.md
docs/SECURITY_REMEDIATION.md
docs/TESTING.md
docs/V2_SECURITY_REQUIREMENTS.md
docs/WALLET.md
docs/X402.md
```

## External configuration evidence

Export these records into a private audit bundle:

```text
audit-materials/alchemy/gas-manager-policy-redacted.json
audit-materials/alchemy/custom-sponsorship-settings-redacted.json
audit-materials/alchemy/hard-limits-redacted.json
audit-materials/alchemy/modular-account-version.txt
audit-materials/alchemy/delegation-source-and-deployment.json
audit-materials/alchemy/delegation-runtime-reproduction.json
audit-materials/alchemy/sample-sponsorship-records-redacted.json
audit-materials/vercel/production-deployment.json
audit-materials/vercel/environment-variable-names-redacted.json
audit-materials/vercel/firewall-and-rate-limits.json
audit-materials/vercel/sample-relay-logs-redacted.json
audit-materials/redis/configuration-redacted.json
audit-materials/redis/concurrency-test-results.json
audit-materials/base-sepolia/independent-runtime-bytecode.json
audit-materials/base-sepolia/contract-wiring.json
audit-materials/dependencies/npm-audit.txt
audit-materials/dependencies/govulncheck.txt
audit-materials/release/source-verification.json
```

These files are part of the signed source tag. The operator must capture each
record before the operator creates the tag.

## Post-tag release evidence

Create these files after the signed source tag and release artifacts exist:

```text
audit-materials/release/signed-tag-verification.txt
audit-materials/release/cosign-verification.txt
audit-materials/release/playtest-archive-smoke.json
audit-materials/release/hosted-deployment-verification.json
```

Store these two files with the private audit bundle and the published release
artifacts. Do not add them to the source tag that they verify.

`signed-tag-verification.txt` must identify the tag, commit, signing identity,
and verification command result. `cosign-verification.txt` must identify the
checksum index, public key, Sigstore bundle, and verification command result.

## Excluded secrets

Exclude these paths from every release and audit transfer:

```text
.ghostclaw/
.operator/
.env.local
.vercel/
```

Remove these values from exported records:

- Base private keys.
- Spend keys.
- Note encryption private keys.
- Demo merchant encryption and local state keys.
- Credential-store values.
- Backup passphrases.
- Wallet backups.
- Alchemy API keys.
- Alchemy policy IDs when the auditor does not need them.
- Callback secrets.
- Redis tokens.
- Rate-limit HMAC secrets.
- Vercel authentication values.
- Cosign private keys.

## Final audit gates

The audit bundle is complete after these conditions pass:

1. The final Git tag has a valid signature.
2. The tag identifies the deployed and tested source.
3. Generated proof and Solidity artifacts reproduce exactly.
4. Both Base RPC sources return the expected runtime hashes.
5. The hosted two-wallet x402 flow passes.
6. Shared Redis failure and concurrency tests pass.
7. The policy shutdown drill passes.
8. Backup, restore, rotation, recovery request, and cancellation drills pass.
9. Emergency undelegation passes or has a documented provider limitation.
10. npm audit and govulncheck report no reachable release vulnerability.
