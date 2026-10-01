# Local proving

GhostClaw creates every private proof on the user machine. The Base contracts verify the proof.

The current implementation uses Consensys gnark, PLONK, and the BN254 curve. It uses Poseidon2 for commitments and Merkle hashing.

## Proof system

PLONK is a zero-knowledge proving system. It proves that private inputs satisfy a circuit without publishing those inputs.

BN254 is an elliptic curve supported by efficient EVM precompiles. The verifier uses these precompiles for the main pairing operations.

The proof is 768 bytes for each current circuit. Public inputs are separate field elements passed to the verifier.

## Setup model

PLONK uses a structured reference string, also called an SRS. The SRS supports circuits up to a maximum size.

GhostClaw uses the public Aztec Ignition universal SRS. The project does not perform a project-specific trusted ceremony.

The security assumption is external. At least one participant in the public ceremony must have destroyed its secret contribution.

A universal SRS can support many circuits. A circuit update does not require GhostClaw to run a new ceremony within the supported size.

## Proving boundary

:::diagram Local proof boundary
Wallet state|The wallet selects one private note and witness.
Private witness|The wallet sends action inputs to the local runtime.
PLONK prover|The runtime creates a proof on the local machine.
Public package|Only the proof and public inputs leave the machine.
Base verifier|The verifier accepts or rejects the state transition.
:::

The wallet sends the witness through a private process channel. It does not include private witness values in command arguments.

The runtime clears action buffers after use. The agent interface does not receive the witness or proof secrets.

## Field and value representation

The circuits operate in the BN254 scalar field. Public accounts and identifiers convert into field elements.

Token amounts use unsigned 64-bit values. The circuits constrain the amount bits to prevent field wraparound.

The circuits also use domain tags. A domain tag separates one hash purpose from another hash purpose.

For example, note commitments, owners, nullifiers, and action digests use different hash contexts.

## Commitment model

A note commitment binds an amount, owner, blinding, and protocol context.

The exact hash inputs use Poseidon2 and fixed domain separation. Fresh blinding makes equal notes produce different commitments.

The spend nullifier derives from the input note and spend authority. The same input note always produces the same nullifier.

Base records the nullifier after a valid spend. A second spend with the same note then fails.

## Merkle membership

The pool commitment tree has depth 20. A payment or withdrawal proof receives 20 sibling hashes and 20 direction bits.

The circuit starts with the input note commitment. It hashes the value with each sibling according to the direction bit.

After 20 levels, the circuit obtains a Merkle root. This root must equal the public spend root.

The pool accepts the proof only if that root remains in the recent-root history.

## Circuit summary

| Circuit | Constraints | Main public result | Proof size |
|---|---:|---|---:|
| Identity | 2,392 | Owner and action digest | 768 bytes |
| Deposit | 2,787 | Note commitment and public amount | 768 bytes |
| Payment | 17,145 | Nullifier, two commitments, payment intent | 768 bytes |
| Withdrawal | 13,776 | Nullifier, change commitment, public amount | 768 bytes |

Constraint counts describe the current compiled circuit shape. They help explain local proving time.

## Identity circuit

The identity circuit proves control of the private owner value associated with a public Base account.

### Public inputs

| Input | Purpose |
|---|---|
| Context | Binds chain, pool, protocol version, and hash domain |
| Owner | Registers the private owner value |
| Action digest | Binds the proof to the public identity action |

### Private inputs

| Input | Purpose |
|---|---|
| Spend key | Creates the owner value |
| Base account | Binds the action to the public account |
| Action code | Separates registration, rotation, and recovery actions |
| Identity nonce | Makes the identity action unique |

The circuit recomputes the owner from the spend key and context. It also recomputes the action digest.

The contract accepts the proof only when both public values match the requested identity action.

## Deposit circuit

The deposit circuit proves that one public token amount creates one correct private note commitment.

### Public inputs

| Input | Purpose |
|---|---|
| Context | Binds chain, pool, protocol version, and domain |
| Commitment | Adds the new note to the tree |
| Amount | Matches the public token transfer |
| Owner | Selects the registered private owner |

### Private inputs

| Input | Purpose |
|---|---|
| Spend key | Proves ownership of the destination owner value |
| Blinding | Hides the note contents inside the commitment |

The circuit requires a nonzero unsigned 64-bit amount. It recomputes the owner and note commitment.

The deposit amount stays public because the pool receives that token amount from the Base account.

## Payment circuit

The payment circuit is the main confidential state-transition circuit.

It spends one input note. It creates one merchant note and one payer change note.

### Public inputs

| Input | Purpose |
|---|---|
| Context | Binds the full protocol context |
| Spend root | Proves membership in an accepted commitment state |
| Nullifier | Prevents a second spend of the input note |
| Output left | Commits to one new private note |
| Output right | Commits to the other new private note |
| Sender owner | Matches the payer identity |
| Recipient owner | Matches the merchant identity |
| Payment intent | Binds settlement to one x402 request |
| Payer | Identifies the public payer account |
| Merchant | Identifies the public merchant account |

### Private inputs

| Input | Purpose |
|---|---|
| Input amount | States the value available for the payment |
| Spend key | Proves control of the input owner |
| Input blinding | Reconstructs the input commitment |
| Merkle siblings | Reconstruct the tree path |
| Merkle directions | Select left or right at each tree level |
| Payment amount | Creates the merchant note |
| Merchant blinding | Hides merchant note contents |
| Change blinding | Hides change note contents |
| Output position | Randomizes merchant note position |
| Request salt and data | Reconstruct the payment intent |

### Enforced rules

The circuit enforces these rules:

1. The spend key produces the sender owner.
2. The input commitment belongs to the spend root.
3. The nullifier matches the input note and spend authority.
4. The payment amount is nonzero.
5. The change amount is nonzero.
6. The input amount equals payment plus change.
7. Both output commitments contain correct owners and values.
8. The output selector places the two commitments correctly.
9. The payer and merchant bind to the payment intent context.
10. The payment intent matches the salted request data.

The circuit never outputs the payment amount or change amount as public inputs.

## Withdrawal circuit

The withdrawal circuit spends one private note and releases a public token amount.

### Public inputs

| Input | Purpose |
|---|---|
| Context | Binds the protocol context |
| Root | Proves input-note membership |
| Nullifier | Prevents a second spend |
| Change commitment | Stores any remaining private value |
| Owner | Matches the registered identity |
| Action digest | Binds the public recipient and action |
| Amount | States the public withdrawal amount |

### Private inputs

The private inputs include the input note, spend key, blinding, Merkle path, recipient, and change blinding.

The circuit proves that the withdrawal amount does not exceed the input amount. It creates a valid change commitment when value remains.

The withdrawal amount stays public because the pool transfers that token amount to the public recipient.

## Verification on Base

The local runtime serializes the proof for the Solidity verifier. The pool passes the proof and public inputs to the correct verifier contract.

The verifier performs elliptic-curve checks and a pairing check. It returns success only when all PLONK relations hold.

The pool then performs state checks that do not belong inside the circuit. These include nullifier uniqueness, root history, identity state, and intent uniqueness.

This split keeps private arithmetic inside the proof. It keeps shared protocol state inside the Base contract.

## Proof failure cases

The runtime or verifier rejects a proof when any constrained value changes.

Examples include:

- Incorrect spend key.
- Incorrect input amount.
- Incorrect Merkle sibling.
- Incorrect direction bit.
- Unknown Merkle root.
- Reused nullifier.
- Incorrect payment intent.
- Incorrect payer or merchant binding.
- Payment larger than the input note.
- Zero payment output.
- Zero change output in the current payment circuit.
- Incorrect withdrawal recipient binding.

## Artifact model

Each circuit has compiled constraint data, a proving key, and a verifying key. The local package contains the prover requirements.

The Base deployment contains one verifier contract for each circuit. Client and contract artifacts must describe the same circuit.

The client checks the artifact identity before proof creation. The contract bytecode fixes the corresponding verifying logic on Base.

## Performance shape

Payment proving performs more work than identity or deposit proving because it includes Merkle membership, value conservation, and two outputs.

Withdrawal proving also includes a Merkle path and change calculation. Proof size stays fixed even when circuit size changes.

Read [Performance](PERFORMANCE.md) for measured proving times. Read [Base contracts](CONTRACTS.md) for the verification path.
