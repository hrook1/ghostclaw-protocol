# Wallet and agents

The GhostClaw wallet runs on the user machine. It controls keys, private notes, proofs, spending policy, and agent access.

The wallet is the privacy boundary. The agent receives payment tools instead of direct key access.

## Client interfaces

The client provides three interfaces for different users.

| Interface | User | Purpose |
|---|---|---|
| CLI | Human or operator | Setup, account management, deposit, withdrawal, and diagnostics |
| MCP server | Agent | Controlled resource payment and budget checks |
| Client library | Application | Fetch-compatible x402 handling and wallet integration |

MCP means Model Context Protocol. It gives an agent a structured list of local tools.

## Key domains

The wallet creates separate keys for separate duties.

| Key | Algorithm | Duty | Shared with agent |
|---|---|---|---:|
| Base transaction key | ECDSA on secp256k1 | Sign public Base transactions | No |
| Spend key | BN254 field secret | Own notes, derive owners, and create nullifiers | No |
| Note key | X25519 | Decrypt incoming note envelopes | No |

The separation limits the effect of one account change. A Base account rotation keeps the same private owner and note history.

The wallet shows the public Base account when required. It never prints private key material during normal use.

## Wallet setup

Wallet setup is a human action. It creates local keys and registers the public GhostClaw identity.

:::diagram Wallet setup
Create keys|The local client creates transaction, spend, and note keys.
Protect state|The client encrypts the wallet state with the operating-system credential store.
Register identity|The client proves and submits the public identity record.
Connect agent|The client adds the local MCP server to an approved agent client.
Set policy|The human selects payment and merchant limits.
:::

The agent can use GhostClaw after setup. It does not participate in key creation or recovery.

## Encrypted local state

The wallet stores note plaintext and key references in encrypted local state.

The current state encryption uses AES-256-GCM. AES-GCM provides confidentiality and integrity for the stored wallet data.

The operating-system credential store protects the state encryption secret. The wallet does not require a hosted account for private state storage.

The local state includes:

- Public account and identity metadata.
- Private note records.
- Commitment positions.
- Merkle witnesses.
- Pending transaction records.
- Spent-note records.
- Spending policy.
- Agent connection state.

## Note lifecycle

A note moves through defined states.

:::diagram Note lifecycle
Created|A deposit or payment creates the note commitment.
Pending|The transaction exists, but the wallet does not have a confirmed witness.
Available|The wallet has a confirmed position and accepted-root witness.
Reserved|A payment process has selected the note.
Spent|Base accepted the note nullifier.
:::

The wallet releases a reserved note when proof creation or submission fails before settlement.

It marks a note spent only after Base confirms the matching nullifier. It checks unknown transaction states before it changes the note status.

## Balance calculation

The private balance is the sum of available and pending local notes. The wallet calculates this value locally.

The agent interface does not return the private balance. It returns only the spending policy and payment result.

The human wallet view can show available and pending amounts separately. This distinction prevents an agent from spending an unconfirmed note.

## Chain synchronization

The wallet reads public pool events from Base. It uses them to rebuild commitment positions and Merkle witnesses.

The wallet checks event order and root continuity. It does not trust a remote snapshot without verification.

A verified snapshot can reduce startup time. Base events remain the source of truth.

The wallet updates a note to available after it confirms the commitment and computes a witness for an accepted root.

## Note selection

The wallet selects the smallest available note that can fund the requested payment and positive change.

This rule reduces unused change without revealing the selected amount. The selection happens before proof creation and stays local.

The current circuit does not support an exact-value payment with zero change. The wallet must select a larger note.

## Incoming notes

The merchant publishes an X25519 note encryption public key in its identity record.

The payer encrypts the merchant note with that key. The merchant receives a fixed-size encrypted envelope in the payment response.

The merchant wallet decrypts the envelope and recomputes the commitment. It accepts the note only when the Base settlement contains that commitment.

The fixed envelope size reduces note-data leakage through message length.

## Agent tools

The public MCP interface has a small tool set.

### `ghostclaw_check_budget`

This tool returns the active spending policy.

It can return:

- Maximum amount for one payment.
- Maximum amount for one agent session.
- Maximum amount for one day.
- Remaining session allowance.
- Remaining daily allowance.
- Merchant allowlist state.
- Merchant denylist state.
- Policy expiry.

It does not return the private balance or private note data.

### `ghostclaw_fetch`

This tool requests one HTTP resource. It handles a GhostClaw x402 requirement when the request requires payment.

The tool validates the requirement, checks policy, creates the proof, submits settlement, and retries the request.

It returns the resource, job handle, or a structured error. It does not return private witness data.

## Spending policy

The human controls the spending policy. The wallet evaluates it before proof creation.

| Policy control | Effect |
|---|---|
| Per-payment limit | Caps one quoted payment |
| Per-session limit | Caps total payments during one agent session |
| Daily limit | Caps total payments during one day |
| Merchant allowlist | Restricts payment to selected merchants |
| Merchant denylist | Blocks selected merchants |
| Policy expiry | Stops payment after a selected time |

The agent can read the current policy. It cannot increase a limit or remove a merchant restriction.

## Human approval model

Setup, backup, recovery, account rotation, policy changes, and withdrawals remain human actions.

Payments can run automatically when they stay inside the approved policy. A payment outside the policy stops before proof creation.

An application can require human approval for each payment. This mode does not change the proof or settlement protocol.

## Transaction sponsorship

The wallet can submit public Base writes through a sponsor. This feature lets a user interact without holding Base gas.

The transaction adapter prepares the exact contract call. The sponsor accepts only approved GhostClaw destinations and functions.

The sponsor receives public call data. It does not receive local notes, spend keys, payment amounts, or witness data.

Sponsorship affects gas payment. It does not affect token ownership or proof validity.

## Account rotation

The active account can rotate the public Base account immediately. The identity proof binds the old account, new account, owner, and action.

The private owner value remains unchanged. Existing private notes remain controlled by the same spend key.

The note encryption key can update with the identity record. New senders must use the current registered key.

## Delayed recovery

A separate recovery account can start identity recovery. The contract applies a seven-day delay before completion.

The active account can cancel recovery during the delay. The recovery action does not reveal the spend key.

Recovery moves the public account binding. It does not recreate lost private note secrets.

The user must keep an independent protected backup for full wallet recovery.

## Agent connection

The client adds one local MCP server configuration to a supported agent client. The MCP server communicates over local standard input and output.

This design avoids an open local network port. It also lets several supported agent clients use the same wallet design.

Each agent client starts its own MCP process. The wallet state coordinates local payment locks across processes.

## Concurrency control

The wallet locks a selected note during one payment operation. A second operation cannot select the same note.

The lock has stale-operation recovery. The wallet checks Base before it releases a note from an interrupted transaction.

This process prevents two local agents from creating competing payments with the same input note.

## Error model

The MCP server returns stable error categories. The agent can explain the required human action without reading private wallet data.

Examples include:

- Wallet setup required.
- Spending policy rejected the payment.
- No available note can fund the payment.
- Chain synchronization required.
- Proof creation failed.
- Base submission failed.
- Settlement status is unknown.
- Merchant delivery failed after settlement.

The client must distinguish payment failure from delivery failure. A delivery retry must not create a second payment.

## Privacy boundary

The local wallet has the broadest private access. The proof runtime receives only one action witness.

The agent receives policy and result data. The sponsor receives public transaction data. The merchant receives only its own output note.

Read [Privacy model](PRIVACY.md) for the disclosure matrix. Read [x402 integration](X402.md) for agent request handling.
