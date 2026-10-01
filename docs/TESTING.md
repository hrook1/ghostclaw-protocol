# Testing

## Purpose

The release suite tests the package before a tester receives it. The hosted
acceptance suite tests the exact deployed service before promotion.

The user-experience tests require one approval before guided setup. They check
that cancellation creates no wallet. They also check that progress does not
change the machine-readable result.

The public-tree tests cover the hosted event snapshot, Base delta reads,
snapshot rejection, direct Base fallback, query limits, and rate-limit recovery.
The client checks the tree against Base at one fixed block.

## Complete local suite

Install Node.js 22, Go 1.25.12, and Foundry 1.7.1. Run:

```sh
npm ci --ignore-scripts
npm run test:full
```

The command performs these checks:

1. Run all JavaScript unit and integration tests.
2. Check the npm package contents.
3. Check the pinned public proving files.
4. Run Go tests with the race detector.
5. Run Go static analysis.
6. Build and test all Solidity contracts.
7. Check npm and Go dependencies for known vulnerabilities.
8. Reproduce every proof artifact and Solidity verifier.

## Clean package matrix

Package CI builds each native package on its target runner. It installs the
packed archive into a clean directory. It resolves and verifies the installed
runtime before it reports success.

The source test job builds a temporary Linux x64 runtime before JavaScript
tests. This removes any dependency on an unpublished native package version.

After npm publishes a new native package version, refresh `package-lock.json`.
Run `npm ci --ignore-scripts` before hosted acceptance. This check confirms that
the lock contains the published package metadata for each target.

The matrix contains these targets:

- macOS Apple silicon.
- macOS Intel.
- Linux ARM64.
- Linux x64.
- Windows x64.

Linux runs one additional test as a fresh user with a private primary group.
The test applies npm-style group write permission. It confirms that GhostClaw
removes the safe group-write bit before execution. It rejects unsafe shared
ownership and world write permission.

Windows reads the file access list. It rejects another owner or another writer.
It does not use POSIX mode bits because Windows does not apply those bits.

## Credential-store checks

The wallet probes the configured credential store during `doctor`. A locked
store returns `GHOSTCLAW_CREDENTIAL_STORE_LOCKED`. The message tells the user
to sign out and sign in.

The unit suite simulates the locked state. A clean-machine acceptance test must
also run `ghostclaw doctor` before it starts a payment.

## Vercel runtime check

The JavaScript suite starts the real merchant note inspector with `VERCEL=1`.
It removes `LAMBDA_TASK_ROOT`. This reproduces the missing-variable condition
that caused the hosted delivery failure.

The test also checks that `vercel.json` bundles the Linux x64 native package.

## Read-only hosted check

Run this check against a Vercel Preview or Production:

```sh
npm run verify:hosted -- --relay https://DEPLOYMENT.example
```

The check reads relay health, proving files, Base contracts, and deployed code.
It does not create a wallet or send a transaction.

## Paid hosted acceptance

Run this check only on Base Sepolia:

```sh
npm run verify:hosted-payment -- \
  --relay https://DEPLOYMENT.example \
  --confirm-testnet
```

The command creates a temporary wallet. It claims 100 test gUSD and deposits
the test asset. It buys one address report through `ghostclaw_fetch`.

The hosted workflow stages and verifies the pinned proving files before it
creates the temporary wallet. The workflow stops before Base if a file is
missing or changed.

The command retrieves the durable report. If delivery fails after settlement,
it retries the same request once. It requires a total spend of exactly one test
gUSD. It then deletes the temporary wallet.

The paid check also uses the public note snapshot. This prevents a fresh test
runner from sending many event queries to the public Base endpoint.

The read-only hosted check compares the snapshot event count and final event
root with the pool state at the snapshot block.

The hosted feed uses the same 2,000-block inclusive limit as direct Base reads.
The service limits concurrent upstream requests and returns one shared cached
response.

The service test forces one provider limit. The service must wait and retry the
same public event read.

Hosted failure logs contain a fixed stage label only. Check that these logs do
not contain an RPC URL, a wallet address, a note, a balance, or an amount.

## Guided start acceptance

Run this check only on Base Sepolia:

```sh
npm run verify:guided-start -- --confirm-testnet
```

The command runs the exact guided setup with a temporary wallet. It checks the
registration, claim, private deposit, public output, and sponsored transaction
records. It runs guided setup again and requires zero additional funding work.
It deletes the temporary wallet after the check.

## Vercel release order

1. Deploy one immutable Preview from the release commit.
2. Run the complete local suite.
3. Run the guided start acceptance.
4. Run the read-only hosted check against the Preview.
5. Run the paid hosted acceptance against the Preview.
6. Promote the same Preview without a rebuild.
7. Run both hosted checks against Production.
8. Publish the npm package.

## Failure rules

Stop the release when any required check fails. Keep the failed deployment for
inspection. Do not promote a rebuilt copy under the same acceptance result.

Treat a paid delivery failure as a release blocker. Check the settlement before
any retry. Require the recorded settlement for the retry. Require the local
budget to decrease only once.
