# System architecture

GhostClaw has five main layers. Each layer has one clear responsibility.

The local client holds private state. The proof runtime proves a valid state change. The transaction adapter submits public transaction data.

The Base contracts verify and record settlement. The merchant validates the settlement before it delivers the service.

:::diagram End-to-end architecture
Agent client|Requests a resource through MCP or the client library.
Local wallet|Stores keys, notes, witnesses, and spending policy.
Proof runtime|Creates a zero-knowledge proof from the private witness.
Transaction adapter|Submits the prepared Base transaction.
Base contracts|Verify the proof and update the commitment state.
Merchant service|Checks settlement and returns the paid resource.
:::

## Component map

| Component | Location | Main responsibility | Private data access |
|---|---|---|---|
| Agent | Local agent process | Selects a service and requests payment | No spend key or note plaintext |
| MCP server | Local process | Gives the agent controlled GhostClaw tools | Policy result only |
| Wallet | Local process | Holds keys, notes, and witnesses | Full local wallet data |
| Proof runtime | Local process | Creates proofs for protocol actions | Private witness for one action |
| Transaction adapter | Local or hosted route | Submits approved contract calls | Public transaction data only |
| Sponsor | Hosted service | Pays Base gas for approved calls | Public transaction data only |
| Pool contract | Base | Stores protocol state and verifies transitions | No private witness |
| Verifier contracts | Base | Check PLONK proofs | Proof and public inputs only |
| Merchant service | Merchant system | Quotes, validates, and delivers | Merchant output note only |

## Local client layer

The local client is the user entry point. It provides a human CLI, an MCP server, and a fetch-compatible payment interface.

The client creates three key domains:

- A Base transaction key signs public registration and prepared transactions.
- A spend key controls private notes and creates nullifiers.
- An X25519 note key decrypts note envelopes from other users.

The client keeps these domains separate. A Base account rotation does not change the private spend key.

The wallet tracks two balance states. **Available** value has a confirmed commitment and a usable Merkle witness. **Pending** value waits for chain confirmation or local synchronization.

The local state contains note plaintext, note status, commitment positions, and witness data. The client encrypts the state before storage.

## Agent boundary

The MCP server is the boundary between the agent and the wallet.

The public agent interface gives the agent two core capabilities:

- `ghostclaw_check_budget` reads the current spending policy.
- `ghostclaw_fetch` requests a resource and handles an x402 payment when required.

The agent can request a payment. It cannot read the spend key, note key, private balance, note plaintext, or Merkle witness.

The human controls spending limits. The agent can read the effective limits. It cannot change them through MCP.

## Wallet state model

Each private note contains these logical fields:

| Field | Purpose |
|---|---|
| Amount | Value stored in the note |
| Owner | Private owner value derived from the spend key |
| Blinding | Random value that hides repeated note contents |
| Commitment | Public one-way representation of the note |
| Position | Leaf position in the commitment tree |
| Status | Pending, available, or spent |

The public owner value binds notes to one spend key. The Base account maps a public identity to that owner value.

The wallet selects an available note that can fund the payment. The current payment circuit requires a positive change output.

## Proof runtime layer

The proof runtime is a local binary. It uses Consensys gnark with PLONK over the BN254 curve.

PLONK is a zero-knowledge proof system. BN254 is an elliptic curve with efficient verification support on EVM networks.

The runtime supports four circuits:

| Circuit | Purpose | Main private input |
|---|---|---|
| Identity | Register or update an identity | Spend key and identity nonce |
| Deposit | Create a note from a public deposit | Note blinding |
| Payment | Spend one note and create payment and change notes | Input note, path, amount, output blindings |
| Withdrawal | Spend one note and release a public token amount | Input note, path, withdrawal amount |

The runtime receives the private witness through a private process channel. It does not place the witness in the command line.

The runtime outputs a fixed-size proof and public inputs. The proof is currently 768 bytes for each circuit.

## Transaction adapter layer

The transaction adapter converts one prepared action into one exact Base contract call.

The adapter has two submission modes:

- Direct mode uses the user Base transaction key and user gas.
- Sponsored mode sends the public prepared transaction to an approved sponsor.

The sponsor sees the contract address, function selector, proof, public inputs, gas estimate, and transaction result. It does not receive private note data.

The adapter validates the destination and function before submission. It reports the final Base transaction hash to the wallet.

## Base contract layer

The Base layer contains a pool contract, a token contract, four verifier contracts, and Poseidon2 hash support.

Poseidon2 is a hash function designed for efficient use inside zero-knowledge circuits.

The pool contract stores:

- Public identity registrations.
- Commitment tree leaves and roots.
- A recent-root history.
- Nullifiers for spent notes.
- Payment intent usage.
- Escrowed tokens.

The pool uses an append-only Poseidon2 Merkle tree with depth 20. The tree can hold 1,048,576 commitments.

Each state transition reserves two leaf positions. A deposit writes one commitment and one zero leaf. A payment writes payment and change commitments.

A withdrawal writes a change commitment and one zero leaf. A complete withdrawal can write two zero leaves.

The pool keeps 256 recent roots. A proof can use one accepted recent root while other users add new commitments.

## Identity layer

Each GhostClaw identity connects one public Base account to one private owner value and one note encryption key.

The owner value derives from the spend key, chain, pool, and protocol context. This binding prevents cross-chain or cross-pool reuse.

The identity system supports immediate account rotation with the current account. It also supports delayed recovery through a separate recovery account.

The recovery delay is seven days. The delay gives the owner time to respond to an unwanted recovery request.

## Merchant layer

The merchant publishes an x402 payment requirement. The requirement identifies the network, asset, pool, merchant, price, request, and expiry.

The merchant also publishes a note encryption public key. The payer uses this key to encrypt the merchant note.

After settlement, the merchant checks the Base transaction, event, commitment, root, request binding, and replay status.

The merchant then decrypts its output note. It adds the note to its local wallet after the commitment becomes available.

## Settlement data flow

:::diagram Payment data flow
x402 requirement|Public quote, merchant, asset, pool, request, and expiry.
Private witness|Input note, amount, path, and output secrets stay local.
Proof package|Proof, public inputs, commitments, and payment intent.
Base settlement|Nullifier, commitments, root, identities, and event.
Delivery response|Resource or durable job handle returns to the agent.
:::

The payment amount appears in the x402 requirement that the payer receives. It does not appear in the Base settlement event.

The merchant learns the amount because it created the price and decrypts its output note. Public observers cannot read that amount from the pool.

## State synchronization

The wallet reads public commitment and root events from Base. It reconstructs the commitment tree locally.

The wallet verifies each event sequence before it updates a witness. It treats remote snapshots as untrusted acceleration data.

If a snapshot fails verification, the wallet rebuilds the required state from Base events. This process does not require a private indexing service.

The wallet marks a note available only after it has a valid commitment position and witness for an accepted root.

## Failure boundaries

| Failure | Effect | Recovery path |
|---|---|---|
| Agent client stops | No new request starts | Restart the agent client |
| Proof process stops | No payment proof completes | Restart proof creation |
| Sponsor refuses | Sponsored submission stops | Retry or use direct submission |
| Base transaction reverts | State does not change | Correct the public call and resubmit |
| Wallet state is stale | Note cannot produce a current witness | Synchronize from Base |
| Merchant delivery fails | Settlement remains final | Use the durable delivery handle |

## Architecture guarantees

The proof enforces note ownership, membership, value conservation, output validity, and request binding.

The pool enforces proof verification, nullifier uniqueness, root acceptance, identity state, and payment intent uniqueness.

The local client enforces spending policy before proof creation. The merchant enforces delivery rules after settlement.

These controls form one payment path. No single hosted component can create a valid private payment alone.

## Read next

Read [Payment flow](PAYMENT_FLOW.md) for the complete message sequence. Read [Local proving](PROVING.md) for each circuit and public input.
