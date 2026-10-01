# Contract

## Source files

| File | Purpose |
|---|---|
| `contracts/GhostClawGnarkPlonkPoolV2.sol` | Holds test gUSD and protocol state. |
| `contracts/GhostClawTestUSDV2.sol` | Supplies one 100 gUSD test claim per address. |
| `contracts/generated/GhostClawGnarkIdentityVerifierV2.sol` | Checks identity proofs. |
| `contracts/generated/GhostClawGnarkDepositVerifierV2.sol` | Checks deposit proofs. |
| `contracts/generated/GhostClawGnarkSpendVerifierV2.sol` | Checks payment proofs. |
| `contracts/generated/GhostClawGnarkWithdrawVerifierV2.sol` | Checks withdrawal proofs. |
| `contracts/generated/GhostClawPoseidon2BN254.sol` | Calculates tree and action hashes. |

The build uses Solidity `0.8.30`, Cancun EVM output, and 200 optimizer runs.

## Constructor

The pool constructor accepts these fixed addresses:

```solidity
constructor(
    address tokenAddress,
    address identityVerifierAddress,
    address depositVerifierAddress,
    address spendVerifierAddress,
    address withdrawVerifierAddress,
    address poseidon2Address
)
```

The constructor checks Base Sepolia chain ID `84532`. It checks that each
address contains code. The six addresses become immutable fields.

The constructor calculates the 20 zero-tree levels. It stores the empty root as
the first valid root.

## Fixed protocol values

| Name | Value |
|---|---:|
| `PROTOCOL_VERSION` | 2 |
| `TREE_DEPTH` | 20 |
| `TREE_CAPACITY` | 1,048,576 leaves |
| `ROOT_HISTORY_SIZE` | 256 roots |
| `RECOVERY_DELAY` | 7 days |
| `BASE_SEPOLIA_CHAIN_ID` | 84532 |

## Identity state

`ownerOf(account)` returns the owner field for a Base account.

`accountForOwner(owner)` returns the current Base account for an owner.

`identityNonce(owner)` prevents action replay.

`pendingRecovery(owner)` stores a current account, new account, execution time,
and nonce.

### Registration

`registerSelf(proof, owner)` verifies spend-key knowledge for `msg.sender`. It
requires unused account and owner values.

### Immediate rotation

`rotateAccount(proof, newAccount, deadline, newAccountSignature)` requires an
identity proof from the current spend key. It also requires consent from the
new Base account.

The function cancels a pending recovery for the same owner. It then moves the
identity to the new account.

### Delayed recovery

`requestRecovery(proof, owner, newAccount, deadline, newAccountSignature)`
starts a seven-day delay. The proof binds the spend key, new account, recovery
action, and current identity nonce.

The current account can call `cancelRecovery(owner)`. Any account can call
`finalizeRecovery(owner)` after the delay. The stored target account controls
the result.

## Note state

`commitments(commitment)` records each inserted nonzero commitment.

`nullifiers(nullifier)` records each spent note.

`settledPaymentIntents(paymentIntent)` prevents settlement replay.

`roots(root)` identifies a currently retained root. The pool stores the latest
256 roots in a ring buffer.

`nextLeafIndex` gives the next unused leaf position. Each transition advances
this value by two.

## Tree insertion

`_appendPair(left, right)` first hashes the pair. It then walks 19 upper levels.
The function stores one filled subtree for each applicable level.

This pair insertion performs one lower hash and 19 upper hashes. A transition
therefore uses 20 Poseidon2 hashes for its tree update.

No keeper or batch service controls insertion. The user transaction completes
the insertion onchain.

## Deposit

```solidity
deposit(bytes proof, uint256 commitment, uint64 amount)
```

The caller must have a registered owner. The proof binds the owner, public
amount, commitment, and pool context.

The contract transfers the exact amount into escrow. It rejects tokens that
change the transfer amount. It then appends `(commitment, 0)` to the tree.

The deposit account and amount are public.

## Confidential payment

```solidity
confidentialTransfer(
    bytes proof,
    uint256 spendRoot,
    uint256 nullifier,
    uint256 outputLeft,
    uint256 outputRight,
    uint256 recipientOwner,
    uint256 paymentIntent,
    address merchant
)
```

The caller must own `senderOwner`. The merchant must own `recipientOwner`. The
root must be retained.

The contract rejects used nullifiers, used payment intents, duplicate output
commitments, and invalid field values. The verifier binds the public payer and
merchant to the private value transition.

The contract records all replay markers before it emits `X402Settlement`. It
appends both output commitments to the tree. No ERC-20 transfer occurs during
this call.

## Withdrawal

```solidity
withdraw(
    bytes proof,
    uint256 spendRoot,
    uint256 nullifier,
    uint256 changeCommitment,
    address recipient,
    uint64 amount
)
```

The proof binds the registered owner, public payer, recipient, amount, root,
nullifier, and change commitment.

The contract marks the nullifier. It appends `(changeCommitment, 0)`. It then
transfers the exact public amount to the recipient.

## Reentrancy and token checks

Deposit, payment, and withdrawal use one reentrancy lock. State changes occur
before an external withdrawal transfer.

The pool accepts tokens only when `transfer` and `transferFrom` succeed. Empty
return data and an encoded `true` value are accepted. Another return value
causes failure.

The pool compares token balances around each transfer. This check protects the
escrow counter from transfer fees and rebasing behavior.

## Events

| Event | Purpose |
|---|---|
| `IdentityRegistered` | Records the initial account and owner. |
| `AccountRotated` | Records an immediate account change. |
| `RecoveryRequested` | Starts the seven-day delay. |
| `RecoveryCancelled` | Cancels a pending recovery. |
| `RecoveryFinalized` | Completes a delayed account change. |
| `NotesInserted` | Records the leaf pair and new tree root. |
| `Deposit` | Records a public deposit. |
| `X402Settlement` | Records a confidential x402 payment. |
| `Withdrawal` | Records a public withdrawal. |

`X402Settlement` contains public payer and merchant addresses. It contains no
payment amount.

## Contract size

| Contract | Runtime size |
|---|---:|
| Pool | 12,558 bytes |
| Test gUSD | 1,726 bytes |
| Identity verifier | 7,234 bytes |
| Deposit verifier | 7,234 bytes |
| Payment verifier | 7,234 bytes |
| Withdrawal verifier | 7,229 bytes |
| Poseidon2 | 7,585 bytes |

The EIP-170 runtime limit is 24,576 bytes. The build checks every size in CI.

## Test coverage

The Foundry tests cover valid state transitions, invalid proofs, replay,
identity binding, account rotation, delayed recovery, cancellation, tree roots,
token accounting, and reentrancy.

The real-proof test sends the committed gnark fixtures through the generated
verifiers.
