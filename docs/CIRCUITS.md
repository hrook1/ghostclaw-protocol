# Circuits

## Common rules

All circuits use the BN254 scalar field. Consensys gnark compiles the circuits
for PLONK with KZG commitments.

The circuits use Poseidon2 for the depth-20 Merkle tree. Domain-separated note,
owner, nullifier, and payment hashes use the protocol hash functions in
`internal/model`.

The pool address supplies the public context. The owner derivation also binds
protocol version `2` and Base Sepolia chain ID `84532`.

Each proof is 768 bytes.

## Identity circuit

Source: `internal/circuit/v2.go`, type `IdentityV2`

Constraints: `2,392`

Public inputs:

| Position | Name | Meaning |
|---:|---|---|
| 0 | `Context` | Pool address as a field element. |
| 1 | `Owner` | Public private-note owner identifier. |
| 2 | `ActionDigest` | Bound account action. |

Private witness:

- Spend key.
- Base account.
- Action code.
- Identity nonce.

The circuit proves this owner statement:

```text
Owner = OwnerV2(Context, SpendKey)
```

It also proves the action digest for registration, rotation, or recovery. The
contract calculates the same digest from its current state.

## Deposit circuit

Source: `internal/circuit/v2.go`, type `DepositV2`

Constraints: `2,787`

Public inputs:

| Position | Name | Meaning |
|---:|---|---|
| 0 | `Context` | Pool address. |
| 1 | `Commitment` | New note commitment. |
| 2 | `Amount` | Public deposit amount. |
| 3 | `Owner` | Registered owner field. |

Private witness:

- Spend key.
- Note blinding.

The circuit checks a nonzero unsigned 64-bit amount. It derives the owner from
the spend key. It then derives the note commitment from the context, amount,
owner, and blinding.

## Confidential payment circuit

Source: `internal/circuit/v2.go`, type `SpendV2`

Constraints: `17,145`

Public inputs:

| Position | Name | Meaning |
|---:|---|---|
| 0 | `Context` | Pool address. |
| 1 | `SpendRoot` | Retained depth-20 tree root. |
| 2 | `Nullifier` | One-time input-note marker. |
| 3 | `OutputLeft` | First new commitment. |
| 4 | `OutputRight` | Second new commitment. |
| 5 | `SenderOwner` | Payer owner field. |
| 6 | `RecipientOwner` | Merchant owner field. |
| 7 | `PaymentIntent` | Bound x402 settlement identifier. |
| 8 | `Payer` | Public Base payer address. |
| 9 | `Merchant` | Public Base merchant address. |

Private witness:

- Input note amount.
- Spend key.
- Input note blinding.
- Twenty sibling values.
- Twenty path bits.
- Payment amount.
- Merchant-note blinding.
- Change-note blinding.
- Merchant output position.
- Salted x402 request digest.

The circuit checks input-note membership under `SpendRoot`. It checks note
ownership with the spend key. It proves this balance equation:

```text
input amount = payment amount + change amount
```

The payment amount and change amount use unsigned 64-bit ranges. Both amounts
must be nonzero. A payment therefore uses one input note and creates two output
notes.

The merchant output position is a private Boolean value. The circuit maps the
merchant commitment and change commitment to `OutputLeft` and `OutputRight`.

The nullifier binds the pool context, spend key, and input commitment. The
payment intent binds these values:

- Pool context.
- Salted x402 request digest.
- Private payment amount.
- Payer owner.
- Merchant owner.
- Base payer.
- Base merchant.

## Withdrawal circuit

Source: `internal/circuit/v2.go`, type `WithdrawV2`

Constraints: `13,776`

Public inputs:

| Position | Name | Meaning |
|---:|---|---|
| 0 | `Context` | Pool address. |
| 1 | `SpendRoot` | Retained depth-20 tree root. |
| 2 | `Nullifier` | One-time input-note marker. |
| 3 | `ChangeCommitment` | New private change note or zero. |
| 4 | `Owner` | Registered owner field. |
| 5 | `ActionDigest` | Bound payer, recipient, and amount. |
| 6 | `Amount` | Public withdrawal amount. |

Private witness:

- Input note amount.
- Spend key.
- Public payer address.
- Public recipient address.
- Input note blinding.
- Twenty sibling values.
- Twenty path bits.
- Change-note blinding.

The circuit checks membership and ownership. The amount must be a nonzero
unsigned 64-bit value. The amount cannot exceed the input amount.

A partial withdrawal creates a private change commitment. A full withdrawal
uses zero for `ChangeCommitment`.

## Tree witness

The path has 20 levels. A path bit equal to zero places the current node on the
left. A path bit equal to one places it on the right.

The local wallet rebuilds the public leaf list from `NotesInserted` events. It
checks the current root before it gives a path to the prover.

The pool keeps 256 recent roots. A local proof must use one of those roots when
the transaction executes.

## Negative cases

The tests reject these cases:

- An incorrect spend key.
- An incorrect Merkle path.
- A changed public identity.
- A changed merchant.
- A changed x402 request digest.
- A changed private amount.
- A changed withdrawal recipient.
- A value outside the unsigned 64-bit range.
- A reused nullifier or payment intent at the contract layer.

See `internal/circuit/v2_test.go`, `internal/operation/v2_test.go`, and
`test/GhostClawGnarkPlonkPoolV2Real.t.sol`.
