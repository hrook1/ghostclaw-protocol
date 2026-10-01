# Protocol security requirements

## Release purpose

GhostClaw is a production-shaped Base Sepolia release. It uses valueless gUSD.
The complete payment path must match the intended production path.

An independent auditor must review the final signed tag. The project can call
the release audited only after that review is complete.

## Protocol requirements

### Proof system

- Use Gnark PLONK on BN254.
- Use the pinned Aztec Ignition transcript.
- Require no project ceremony.
- Reproduce every circuit artifact and Solidity verifier.
- Pin the hash of every artifact and verifier.

### Identity registration

- Derive each owner from the protocol version, chain ID, pool address, and spend
  key.
- Require a zero-knowledge proof of spend-key knowledge for registration.
- Bind the registration proof to the registering Base account.
- Reject proof copying, owner squatting, registration races, and cross-pool
  replay.

### Account rotation and recovery

- Permit immediate account rotation only with current-account authorization,
  old spend-key knowledge, and new-account consent.
- Permit emergency account recovery with old spend-key knowledge and
  new-account consent.
- Apply a seven-day delay to emergency recovery.
- Let the current account cancel a pending recovery.
- Use identity nonces for all rotation and recovery actions.
- Reject expired, repeated, changed, or cross-chain authorizations.
- Keep the owner and spend key unchanged during account recovery. This keeps
  existing notes spendable.

### Note tree

- Use an append-only Merkle tree with depth 20.
- Support 1,048,576 public note positions.
- Append two positions for each state transition.
- Use an unspendable zero position when an action creates one note.
- Use Poseidon2 BN254 compression for the Merkle tree.
- Verify the Poseidon2 result across Go, the circuit, and Solidity.
- Keep the latest 256 roots valid for concurrent local proofs.
- Reject a root after it leaves the historical window.
- Emit enough public data for a wallet to rebuild the tree without an indexer.
- Verify the rebuilt root before a wallet uses a witness.

### Confidential payment output roles

- Randomize the merchant note position in each two-note payment output.
- Publish two output commitments without recipient and change labels.
- Put the private output position in the encrypted merchant note.
- Keep payer and merchant Base identities public.
- Keep the payment amount, balances, note secrets, and request salt private.

### Merchant settlement

- Require the complete versioned payment response.
- Require the merchant's original x402 request bytes.
- Fetch the transaction, receipt, and current block from an independent RPC.
- Decode the exact EntryPoint operation and pool call.
- Match the payer, merchant, payment intent, nullifier, commitments, tree index,
  and tree root.
- Recompute the note commitment, output pair, request binding, and payment
  intent locally.
- Confirm the commitment, root, nullifier, and intent in Base state.
- Persist and reject repeated salts, payment intents, transaction hashes, and
  commitments.

### Asset safety

- Keep exact token balance-delta checks for deposits and withdrawals.
- Keep 64-bit value constraints and conservation inside each circuit.
- Keep nullifier and payment-intent replay protection.
- Keep non-reentrant state transitions.
- Test fee tokens, false-return tokens, callback tokens, and reentrant tokens.

## Wallet requirements

- Generate spend, note-encryption, and transaction keys locally.
- Store each key domain separately.
- Use the operating-system credential store for local encryption keys.
- Support an external hardware signer interface for Base authorizations.
- Provide encrypted backup, restore, and restore-verification commands.
- Test recovery from a clean machine state.
- Verify file type, ownership, mode, and symlink state.
- Pin the local prover binary and all proving artifacts.
- Apply time, memory, input, and output limits to prover work.
- Clear mutable secret buffers when the runtime permits it.
- Provide and test EIP-7702 emergency undelegation.

## Relay requirements

- Keep all provider credentials on the server.
- Accept only the documented Wallet API methods.
- Decode and authorize every target, function, argument, chain, sender,
  signature, delegation, and paymaster value.
- Use shared atomic Redis limits for route, method, IP, sender, cost, and global
  usage.
- Apply limits to the public relay and sponsorship callback.
- Protect Redis identities with HMAC.
- Authenticate the sponsorship callback.
- Run an independent Base simulation before sponsorship.
- Fail closed for Redis, simulation, callback, RPC, or policy errors.
- Set hard Alchemy cost, gas, sender, transaction, and count limits.
- Disable sponsorship after callback errors or timeouts.
- Apply Vercel firewall limits before a function starts.
- Keep request bodies out of infrastructure logs.
- Monitor usage, cost, new senders, and revert rate.
- Pause the Alchemy policy automatically after a limit breach.

## Supply-chain requirements

- Commit every source, deployment, verification, and migration script.
- Build from a clean signed Git tag.
- Create a deterministic source archive.
- Create file hashes, a CycloneDX SBOM, and SLSA provenance.
- Sign the release checksum with an offline release key.
- Include exact third-party source, compiler inputs, audits, and deployment
  records.
- Verify the released archive from a new directory before publication.

## Required tests

- Differential tests for Go, circuit, Solidity, wallet, and merchant public
  inputs.
- Property tests for field and 64-bit boundaries.
- Tests for every Merkle position bit and historical-root expiry.
- Tests for duplicate notes, nullifiers, intents, and roots.
- Tests for registration copying and mempool races.
- Tests for immediate rotation, delayed recovery, cancellation, expiry, and
  replay.
- Tests for malformed proofs, fields, signatures, calls, and EIP-7702 data.
- Concurrent multi-instance Redis tests.
- Live fail-closed simulation and automatic policy shutdown tests.
- A live two-wallet claim, deposit, payment, merchant receipt, and withdrawal.
- A live wallet rotation and recovery drill.
- A live undelegation and re-delegation drill.

## Release evidence

The final audit package must contain:

- the signed Git tag and commit;
- the independent audit report and remediation response;
- circuit and verifier reproduction logs;
- contract deployment and source-verification records;
- Base runtime hashes and immutable wiring;
- redacted Alchemy, Vercel, and Redis configurations;
- rate-limit and policy-shutdown results;
- two-wallet and recovery transaction records;
- archive hashes, SBOM, provenance, and release signature;
- measured local proof time, proof size, transaction gas, and confirmation time.
