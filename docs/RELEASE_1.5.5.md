# GhostClaw 1.5.5

## Scope

This release improves the first payment on a clean machine.

The wallet requests a public commitment snapshot from the hosted relay. The
request contains no wallet address, note, balance, or payment amount. The
wallet rebuilds the tree locally and checks it against Base before proof use.

An unavailable or incorrect snapshot starts a direct Base read. The wallet
slows direct event queries and retries Base rate limits automatically.

## Verification

The release suite checks these paths:

- A valid hosted snapshot plus later Base events.
- A changed snapshot and direct Base fallback.
- A missing snapshot and direct Base fallback.
- Base event-query range limits.
- Base rate-limit recovery.
- One fixed Base block for event and pool-state checks.
- Hosted snapshot route limits and upstream failure redaction.
- A clean guided setup and confidential paid report on Base Sepolia.

This release uses the pinned `1.5.0` proving files. It does not change a circuit,
verifier, contract, key format, privacy claim, or trusted-setup assumption.

The release uses the signed `1.5.4` native runtime packages. Their Go source and
binary inputs did not change. This keeps the hosted merchant runtime available
before the `1.5.5` JavaScript packages are published.
