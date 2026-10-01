# Security model

## Release status

This release is for Base Sepolia evaluation with valueless test gUSD. The final
source includes the audit remediation work. An independent auditor must review
the signed release before a production claim.

Do not use this deployment for assets with market value.

## Protected properties

The protocol aims to protect these properties:

- A payment amount stays out of public call data and events.
- An unspent note balance stays private.
- A note can be spent only with its spend key.
- One input value equals the two payment outputs.
- A withdrawal cannot exceed its input note.
- A nullifier can settle only one spend.
- A payment intent can settle only one x402 request.
- The public payer and merchant match the proof statement.
- The pool token balance matches its escrow counter.
- The local Base key signs the exact checked call.

## Public information

Base observers can see payer and merchant addresses. They can see deposits,
withdrawals, proof bytes, commitments, nullifiers, roots, timing, and gas use.

The relay sees the public call and source network metadata. The merchant learns
the payment amount after note decryption.

The public note snapshot endpoint sees source network metadata. Its request
contains no wallet address, note, balance, or payment amount. Its response
contains only public Base commitment events.

The system provides confidential amounts. It does not provide identity
anonymity or complete graph privacy.

The hosted address-report demo has a separate merchant boundary. Vercel holds
the demo merchant encryption secret. Redis stores only authenticated wallet
ciphertext. A Vercel runtime compromise can steal the demo merchant wallet.
It cannot steal a payer wallet or reveal a payer private balance.

## Circuit controls

The payment circuit checks depth-20 tree membership. It binds both public
identities and owner fields. It proves amount conservation with unsigned 64-bit
ranges.

The output position is private. This prevents a fixed public label for the
merchant commitment.

The withdrawal circuit binds the public payer, recipient, and amount. The
identity circuit binds registration, rotation, and recovery actions to a nonce.

## Contract controls

The pool applies these controls:

- Base Sepolia constructor check.
- Fixed verifier, token, and Poseidon2 addresses.
- One-to-one account and owner mapping.
- Recent-root membership check.
- Nullifier replay protection.
- Payment-intent replay protection.
- Commitment duplication checks.
- Reentrancy lock.
- Exact token balance checks.
- State changes before token transfer.
- New-account signature consent.
- Seven-day delayed recovery.
- Current-account recovery cancellation.

Each transaction completes its own tree insertion onchain. No keeper can block
note availability after a confirmed transaction.

## Wallet controls

The wallet separates the transaction, spend, and note keys. It encrypts each
domain. It checks file ownership, permissions, and file type.

Private payment fields and proof witnesses use standard input. The proof process
has memory, time, and output limits.

The wallet records a pending action before a Base write. It can reconcile an
interrupted action from public state.

Encrypted backups support another machine. Immediate rotation and delayed
recovery support transaction-account changes. Emergency undelegation removes
the EIP-7702 account implementation.

## Transaction adapter controls

The adapter checks the complete prepared UserOperation before signing. It
checks it again after signing.

The checks include:

- Base Sepolia chain ID.
- Local sender address.
- Contract target.
- Function and encoded arguments.
- Zero native value.
- Sponsored fee state.
- Paymaster address and data.
- UserOperation hash.
- Transaction nonce.
- EIP-7702 authorization nonce.
- Delegation target.
- Delegation runtime size and hash.

The pinned delegation source and dependency archives are in `third_party/`.

## Relay controls

The relay accepts three Wallet API methods. It permits only the listed pool and
test-token calls.

Shared Redis applies atomic route, IP, sender, method, and global limits. HMAC
keys hide raw IP and sender values in Redis.

The Alchemy callback uses a separate secret. The callback repeats the policy and
runs an independent Base simulation. Any safety-service error causes rejection.

The public note snapshot uses the independent Base RPC. The client treats the
snapshot as untrusted. It checks the event order, leaf count, and rebuilt root
against the pool state at the same Base block.

Vercel applies a second IP limit. Alchemy Gas Manager applies hard sponsorship
limits. The operator monitor can deactivate the policy after a spike.

## Proof setup trust

The PLONK verifier uses the Aztec Ignition universal SRS. GhostClaw did not run
a project-specific ceremony.

This design removes a GhostClaw ceremony requirement. It keeps the standard
Ignition assumption. One honest contributor must have destroyed its secret
contribution.

The repository pins and checks the required transcript digest.

## Availability dependencies

The hosted flow depends on Vercel, the shared Redis service, Alchemy Wallet API,
Alchemy Gas Manager, an independent Base RPC, the Base sequencer, and Base
Sepolia.

These services can delay or refuse a transaction. They cannot create a valid
proof or spend a note without the spend key.

A user needs another transaction path and Base gas when sponsorship is absent.

## Residual risks

### Public identity correlation

The payer and merchant addresses are public. Timing can link the service request
to the Base transaction.

### Local compromise

Malware with access to the user account or credential store can steal wallet
secrets and private note data.

### Universal SRS assumption

PLONK soundness depends on the Ignition transcript assumption and the correct
gnark implementation.

### Smart-account dependency

Sponsored writes use Alchemy Modular Account v2 through EIP-7702. A defect in
that runtime can affect the delegated Base account. The adapter pins the exact
runtime and provides an exit command.

### Root history

The contract retains 256 roots. A local proof can become stale after enough
later transactions. The wallet can rebuild a path under a newer root and create
a new proof.

### Testnet behavior

Base Sepolia does not provide a production service-level guarantee. Test gUSD
has no market value.

### Hosted demo merchant

The demo merchant key is online because the service must decrypt received
notes. This is a testnet merchant operations choice. It does not move payer
proof creation or payer keys to the server.

Use a managed signer or isolated merchant service before real-value operation.

## Release controls

The release process requires a clean worktree and a signed Git tag. It creates
a deterministic archive, file hash list, CycloneDX SBOM, and SLSA provenance
statement. Cosign signs the release checksum index.

Cosign writes a Sigstore bundle. The release publishes the matching public key.
Use `cosign verify-blob` with the bundle and public key. Then verify every file
in the checksum index.

The deployment record includes deterministic CREATE2 inputs, transaction hashes,
block numbers, runtime sizes, and runtime hashes.

## Incident response

Read [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md). It defines policy shutdown,
relay isolation, secret replacement, evidence capture, and user notification.

## Reporting a security issue

Share a report through a private channel. Include the release version, affected
file, reproduction steps, expected result, observed result, and impact.

Do not include private keys, wallet backups, or live service credentials.
