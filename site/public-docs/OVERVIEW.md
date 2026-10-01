# GhostClaw overview

GhostClaw is a confidential payment protocol for autonomous agents. It lets an agent pay an identified merchant through x402 on Base.

The merchant identity stays public. The payer identity stays public. The payment amount and private note balance stay confidential.

This model keeps the public reputation system that x402 merchants need. It also limits the financial information that another agent can collect.

## The problem

Agents can read public blockchain data at machine speed. They can combine amounts, timing, frequency, and counterparties into a detailed financial profile.

A payment can expose a budget. A sequence of payments can expose demand, supplier relationships, and operating patterns. This information can affect prices and negotiations.

Standard public payments give the chain enough data to settle the payment. They also give every observer the same data.

GhostClaw separates settlement data from private value data. Base receives the information that it needs to verify a valid state change. The local wallet keeps the private witness.

## Product model

GhostClaw uses a public identity and a private note system.

A **note** is a private record of value. The note contains an amount, an owner, and secret randomness. The chain stores only a commitment to that note.

A **commitment** is a one-way cryptographic value. It proves that a note exists without exposing the note contents.

A **nullifier** is a unique public value for a spent note. The contract records it to prevent the same note from being spent twice.

A **zero-knowledge proof** proves that a private state change follows the protocol rules. The proof does not publish the private note data.

:::diagram Core payment model
Agent|Requests an x402 resource.
Local wallet|Checks policy and creates a proof.
Base contract|Verifies the proof and records settlement.
Merchant|Checks settlement and delivers the resource.
:::

## What the chain records

Base records public identities, note commitments, Merkle roots, nullifiers, payment intents, and settlement events.

A **Merkle root** is one value that represents the complete commitment tree. A proof can show that one commitment belongs to that tree.

A **payment intent** binds one proof to one x402 request. It prevents a valid payment from being reused for another request.

The settlement event identifies the payer and merchant. It does not include the payment amount.

## What stays on the local machine

The local wallet stores the spend key, note key, private notes, and Merkle witnesses. It creates all private proofs on the local machine.

A **Merkle witness** is the path that connects one note commitment to a Merkle root. The proof uses this path to prove membership.

The agent receives controlled payment tools. It does not receive the spend key or private note plaintext.

The wallet also stores the user spending policy. The policy can limit each payment, session, day, or merchant.

## Supported actions

The current protocol model supports these actions:

- Register a public GhostClaw identity.
- Deposit a public token amount into the private pool.
- Create a confidential payment between registered identities.
- Settle an x402 payment with a confidential amount.
- Withdraw a public amount from the private pool.
- Rotate the public Base account for an identity.
- Recover an identity after the recovery delay.
- Use sponsored Base transactions through the transaction adapter.
- Give an agent a limited payment interface through MCP.

Deposits and withdrawals expose their public amounts. Internal payments hide their amounts.

## System properties

| Property | Current design |
|---|---|
| Settlement network | Base |
| Public identities | Payer and merchant |
| Private data | Payment amount, note amount, note secrets |
| Proof creation | Local machine |
| Proof verification | Base contract |
| Note storage | Local encrypted wallet state |
| Agent interface | Local MCP server and CLI |
| x402 model | Request, requirement, proof-backed payment, delivery |
| Gas payment | Direct user transaction or sponsored transaction |
| Project-specific ceremony | None |

## Trust model

Base enforces the protocol state. A relay cannot create a valid proof without the private witness.

A sponsor can refuse to submit a transaction. It cannot create a payment or change a valid payment amount.

A merchant can refuse to deliver a service. The client binds the payment to the request so the merchant cannot apply it to another request.

The local machine is the private security boundary. Malware with access to the local wallet can compromise the wallet.

The proving system uses a universal structured reference string from an external public ceremony. GhostClaw does not run a project-specific ceremony.

## Privacy scope

GhostClaw provides confidential amounts. It does not provide full sender or recipient anonymity.

An observer can see that a registered payer interacted with a registered merchant. The observer can also see transaction time and contract activity.

The observer cannot read the internal payment amount from the GhostClaw settlement event. The observer cannot read the private note balance from the pool.

This balance supports merchant reputation. It also reduces the financial data available to other agents.

## Read next

Read [Architecture](ARCHITECTURE.md) for the component map. Read [Privacy model](PRIVACY.md) for the exact disclosure boundaries.
