# Base contracts

The GhostClaw contracts hold escrowed tokens and the public commitment state. They verify every private state transition before they update that state.

The current public environment uses Base Sepolia with chain ID `84532`.

## Contract set

:::diagram Contract call path
Client adapter|Builds one exact pool call.
Pool contract|Checks identities, roots, nullifiers, and intents.
Verifier contract|Checks the PLONK proof and public inputs.
Poseidon2 hash|Updates the commitment tree.
Token contract|Moves tokens for deposit or withdrawal.
:::

The contract set contains these logical parts:

| Contract | Responsibility |
|---|---|
| Pool | Escrow, identities, commitments, roots, nullifiers, and actions |
| Identity verifier | Checks identity proofs |
| Deposit verifier | Checks deposit proofs |
| Payment verifier | Checks confidential payment proofs |
| Withdrawal verifier | Checks withdrawal proofs |
| Poseidon2 support | Hashes commitment tree nodes |
| Token | Supplies the public asset used by the pool |

## Protocol constants

| Value | Current setting |
|---|---:|
| Protocol version | 2 |
| Commitment tree depth | 20 |
| Maximum leaf count | 1,048,576 |
| Recent root count | 256 |
| Leaves reserved per transition | 2 |
| Recovery delay | 7 days |
| Test network chain ID | 84532 |

The protocol context includes the chain, pool, version, and hash domain. This context prevents valid data from one deployment moving into another deployment.

## Identity registry

The pool maps one public Base account to one private owner value and one note encryption public key.

The owner value is public. It does not expose the spend key that created it.

The registry supports these actions:

- Register a new identity.
- Rotate from the current Base account to a new Base account.
- Start recovery through the configured recovery account.
- Complete recovery after the seven-day delay.
- Cancel recovery through the active account.

Each identity action uses an identity proof. The proof binds the action type, accounts, nonce, owner, and protocol context.

## Commitment tree

The pool maintains one append-only Poseidon2 Merkle tree.

A leaf contains a note commitment or zero. The contract never changes an existing leaf.

The tree depth is 20. Each insertion pair requires one leaf-pair hash and one hash for each remaining level.

The pool stores the current root and a history of 256 recent roots. The history supports concurrent local proof creation.

A user can create a proof against a recent root. Another user can add commitments before the first user submits the proof.

The first proof remains valid while its root stays in the recent-root history.

## Pair insertion

Every state transition advances the tree by two leaves.

| Action | First leaf | Second leaf |
|---|---|---|
| Deposit | New deposit commitment | Zero |
| Payment | First output commitment | Second output commitment |
| Partial withdrawal | Change commitment | Zero |
| Complete withdrawal | Zero | Zero |

Pair insertion gives each action a stable tree shape. It also lets the payment circuit randomize the merchant output position.

## Root history

The pool records each new root in a ring buffer. A ring buffer reuses fixed storage positions after it reaches its limit.

The contract can test whether a supplied spend root remains accepted. It rejects a proof against a root outside the current history.

The wallet must synchronize and rebuild its witness when its root becomes too old.

## Nullifiers

A nullifier identifies one spent private note without revealing the note commitment.

The pool stores every accepted nullifier. It rejects a transaction when the nullifier already exists.

The payment and withdrawal circuits both produce a nullifier. Deposits do not spend a private note, so they do not produce one.

## Payment intents

A payment intent identifies one x402 settlement request.

The pool stores every accepted payment intent. It rejects a second payment that uses the same intent.

This state prevents replay at the settlement layer. The merchant also stores delivered intents to prevent replay at the service layer.

## Registration transition

The registration path checks the identity proof and the public account state.

The pool then stores the account, owner, note public key, recovery account, and identity nonce.

Registration does not create a private note. It creates the public identity needed for later note ownership and encryption.

## Deposit transition

:::diagram Deposit transition
Public token|The account approves or supplies the deposit amount.
Deposit proof|The proof binds amount, owner, commitment, and context.
Pool escrow|The pool receives the public token amount.
Tree update|The pool appends the commitment and one zero leaf.
:::

The pool checks the registered owner and deposit proof. It transfers the public token amount into escrow.

The pool appends the deposit commitment. It emits the commitment position and new root.

The deposit amount remains public because the token transfer is public.

## Confidential payment transition

The payment transition does not transfer ERC-20 tokens. The tokens remain in pool escrow.

The transaction changes ownership inside the private note state.

The pool checks the following public conditions:

1. The payer identity exists.
2. The merchant identity exists.
3. The sender owner matches the payer identity.
4. The recipient owner matches the merchant identity.
5. The supplied root remains accepted.
6. The nullifier is unused.
7. The payment intent is unused.
8. The proof public inputs use valid field values.
9. The payment verifier accepts the proof.

The pool records the nullifier and payment intent. It appends the two output commitments.

It emits the x402 settlement event after the new root exists.

## Withdrawal transition

The withdrawal transition converts private note value into a public token transfer.

The pool checks the identity, root, nullifier, action digest, amount, and withdrawal proof.

It records the nullifier and appends the change pair. It then transfers the public amount to the recipient.

The proof ensures that the public amount plus private change equals the input note amount.

## Public settlement event

The settlement event gives merchants a stable receipt source.

It contains these logical fields:

| Field | Purpose |
|---|---|
| Payer | Public payer identity |
| Merchant | Public merchant identity |
| Payment intent | Request binding and replay key |
| Nullifier | Spent-note marker |
| Output commitments | New private notes |
| New root | Updated commitment state |

The event does not contain the input amount, payment amount, or change amount.

## Verifier boundary

The verifier contracts check circuit arithmetic. The pool checks shared protocol state.

| Circuit responsibility | Pool responsibility |
|---|---|
| Owner derivation | Current identity record |
| Merkle path reconstruction | Root remains accepted |
| Value conservation | Nullifier remains unused |
| Commitment construction | Payment intent remains unused |
| Request digest construction | Correct verifier and action path |
| Withdrawal change arithmetic | Escrow token transfer |

This boundary avoids placing mutable shared state inside the proof.

## Concurrency model

Users prove against recent roots. They do not prove the contract root transition itself.

This design lets the contract insert output commitments after proof verification. A concurrent payment does not immediately invalidate another local proof.

The root history has a finite size. A delayed transaction must create a new proof if its spend root leaves the history.

## Escrow accounting

Deposits increase the token balance held by the pool. Withdrawals decrease that balance.

Internal payments do not change the pool token balance. They only change which private notes control value inside escrow.

The proof system enforces note-level conservation. The public token contract enforces deposit and withdrawal transfers.

## Revert conditions

The pool rejects a call when one required condition fails.

Common causes include:

- Unknown identity.
- Owner mismatch.
- Unknown or expired root.
- Reused nullifier.
- Reused payment intent.
- Invalid proof.
- Invalid public field value.
- Full commitment tree.
- Incorrect identity nonce.
- Incomplete recovery delay.
- Failed token transfer.

A reverted transaction does not update the commitment tree or spend the nullifier.

## Settlement finality

The merchant chooses the required Base confirmation policy. The payment becomes protocol-valid when the transaction succeeds.

The merchant should release valuable work only after its chosen confirmation threshold.

The client keeps the transaction hash and payment intent. These values support receipt checks and durable delivery.

Read [Local proving](PROVING.md) for circuit checks. Read [Payment flow](PAYMENT_FLOW.md) for merchant delivery.
