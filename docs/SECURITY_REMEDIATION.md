# Security remediation record

## Scope

This record maps the v1.4.1 audit findings to release `1.4.2`. The remediation
includes new circuits, new contracts, a new wallet format, and a new Base
Sepolia deployment.

The public testnet release uses valueless gUSD. Production status remains
no-go until an independent auditor reviews the final signed release.

## Finding status

| ID | Status | Implemented control | Release evidence still required |
|---|---|---|---|
| GC-01 | Verified on Base Sepolia | Merchant import checks the exact request, transaction, receipt, smart-account call, pool call, event, commitment, root, payment intent, confirmations, and replay state. The hosted two-wallet test passed. | Independent audit of the signed release. |
| GC-02 | Verified on Base Sepolia | The release includes the exact Alchemy Modular Account v2 source and upstream audits. The adapter pins the deployment address, runtime size, and runtime hash. A dedicated BSO policy completed two live emergency undelegations. | Independent audit of the signed release. |
| GC-03 | Implemented and tested | Shared Redis applies atomic global, route, method, IP, sender, and weighted-call limits. Vercel applies a second IP limit. The hosted test checks the 120-unit sender boundary with two clients. It also tests invalid credentials. | Retain the dated redacted configuration and test result. |
| GC-04 | Verified on hosted testnet | The callback uses authenticated `webhookData`. It repeats the call policy and runs an independent Base simulation. Callback failure sponsorship is disabled. The shutdown drill stopped a sponsored call and restored service. | Independent infrastructure review. |
| GC-05 | Implemented in source | The deployment and verification scripts are self-contained. The release builder requires a clean signed tag. It creates a deterministic archive, file hashes, SBOM, provenance, and Cosign signature. | Create and verify the final signed tag and release artifacts. |
| GC-06 | Verified on Base Sepolia | Registration proves spend-key knowledge. Owner derivation binds protocol, chain, and pool. Rotation requires spend-key proof and new-account consent. The live recovery request and cancellation passed. | Live finalization remains time-gated. Foundry covers the seven-day transition. |
| GC-07 | Verified on Base Sepolia | The pool uses a depth-20 append-only tree with 1,048,576 leaves and 256 retained roots. The circuit randomizes output roles. Live tree synchronization and merchant import passed. | Independent audit of the signed release. |
| GC-08 | Backup and restore verified | The wallet checks ownership, modes, file types, symbolic links, artifacts, and manifests. It separates key domains. The encrypted backup passed verification and an isolated restore. | Complete the hardware-signer acceptance drill before hardware-wallet support is announced. |
| GC-09 | Implemented | The project requires Go 1.25.12. Tests include `govulncheck`. | Store the final clean vulnerability report. |
| TA-01 | Accepted trust assumption | The loader pins the Ignition digest and checks curve relations. The documentation states the one-honest-contributor assumption. | Retain external transcript provenance in the audit bundle. |

## Fresh Base deployment

The new pool is:

```text
0x415330497f132e8D811b80c3EB96eb15B985f3C6
```

The pool uses new identity, deposit, payment, and withdrawal verifiers. It also
uses a new test token and Poseidon2 contract.

`deployments/base-sepolia-v2.json` records each deterministic address,
transaction hash, block, runtime size, and runtime hash.

`deployments/base-sepolia-v2-preflight.json` records the independent RPC checks.

## Hosted release controls

The hosted release must have these controls active at the same time:

1. Shared Redis rate limits.
2. Vercel firewall rate limit.
3. Secret Alchemy callback authentication.
4. Independent Base simulation.
5. Alchemy callback failure rejection.
6. Alchemy hard sponsorship limits.
7. Sponsorship usage monitor.
8. Secret redaction in relay responses and fatal errors.
9. A separate encryption secret for the hosted demo merchant.
10. Encrypted Redis state and an atomic merchant-wallet lock.

The relay health route must fail when a required environment value is absent.

## Final acceptance tests

Complete these tests before the testnet release announcement:

1. Create two fresh local wallets.
2. Register both identities with sponsored calls.
3. Claim 100 gUSD for the payer.
4. Approve and deposit 100 gUSD.
5. Pay the merchant with one local proof.
6. Import the encrypted merchant note against the original x402 request.
7. Withdraw from a private payer note.
8. Match escrow with the pool token balance.
9. Verify all state through an independent RPC.
10. Request and cancel account recovery.
11. Test emergency undelegation.
12. Test Redis concurrency and failure behavior.
13. Test automatic policy shutdown.
14. Create and verify an encrypted wallet backup.
15. Install the npm package on a clean Node.js 22 host without Go.
16. Buy one hosted address report through `ghostclaw_fetch`.
17. Retrieve the same durable report without a second payment.
18. Start the hosted note inspector without `LAMBDA_TASK_ROOT`.
19. Install the Linux package with private-group write permission.
20. Report a locked operating-system credential store before a payment.

The seven-day recovery finalization test cannot finish in one release session.
The Foundry tests cover the complete time transition. The testnet record must
identify this time-gated live test.

## Local verification

Run:

```sh
npm ci
npm run test:full
```

Run the hosted read-only check against the immutable Vercel deployment. Then
run one paid acceptance check on Base Sepolia. See `docs/TESTING.md`.

The artifact command regenerates all proof artifacts and Solidity verifiers.
It formats the temporary verifier source. It then compares every output byte.

## Release decision

The code can support a public Base Sepolia testnet release after every hosted
control and live acceptance test passes.

A production deployment with valuable assets needs a new audit of the exact
signed release, production infrastructure review, production token review, and
an incident-response exercise.
