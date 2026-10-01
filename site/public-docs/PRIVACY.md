# Privacy model

GhostClaw provides confidential payment amounts and private note balances. It keeps payer and merchant identities public.

This design supports public merchant reputation. It reduces the financial data that an observer can collect from settlement.

## Privacy objective

The protocol hides value while it preserves accountable counterparties.

An agent can prove that it made a valid payment. The proof does not publish the input note amount or output note amounts.

The merchant can link settlement to its x402 request. A public observer can link the payer to the merchant.

## Disclosure map

| Data | Payer | Merchant | Sponsor | Base | Public observer |
|---|---:|---:|---:|---:|---:|
| Payer Base account | Yes | Yes | Yes | Yes | Yes |
| Merchant Base account | Yes | Yes | Yes | Yes | Yes |
| Quoted amount | Yes | Yes | No | No | No |
| Input note amount | Yes | No | No | No | No |
| Merchant output amount | Yes | Yes | No | No | No |
| Change amount | Yes | No | No | No | No |
| Note plaintext | Local note only | Own note only | No | No | No |
| Proof | Yes | Yes | Yes | Yes | Yes |
| Commitments | Yes | Yes | Yes | Yes | Yes |
| Nullifier | Yes | Yes | Yes | Yes | Yes |
| Transaction time | Yes | Yes | Yes | Yes | Yes |
| Payment intent | Yes | Yes | Yes | Yes | Yes |

## Public identity

The payer and merchant use public Base accounts. The pool emits these identities in the x402 settlement event.

This visibility lets a marketplace build merchant reputation. It also lets a merchant prove that it received settlement from a registered payer.

GhostClaw does not hide the relationship between payer and merchant. It hides the value that moved between them.

## Confidential amount

The payment circuit proves value conservation with private amounts.

The input note amount equals the payment amount plus the change amount. The proof checks this equation inside the circuit.

The proof also checks that the payment and change amounts are valid unsigned 64-bit values. The Base contract does not receive these values.

The merchant knows the payment amount because it issued the quote. It also decrypts the output note that contains the amount.

## Private balance

The wallet computes its balance from local note plaintext. It does not publish the resulting balance.

Public commitments do not reveal their amounts. An observer cannot sum commitments to obtain a wallet balance.

The wallet can show the private balance to the human. The MCP interface does not return the private balance to the agent.

## Commitment unlinkability

Each note uses fresh random blinding. Two notes with the same amount and owner produce different commitments.

The payment circuit creates two outputs. One output belongs to the merchant. The other output returns change to the payer.

The circuit randomizes the merchant output position. This process reduces direct output-role inference from leaf order.

It does not create full anonymity. Timing, account activity, and later withdrawals can still support inference.

## Request privacy

The payment intent binds the proof to one x402 request. It includes a salted digest of the request data.

The random salt prevents a public observer from testing a small set of likely request descriptions against the digest.

The merchant receives the salt through the private payment response. The Base event contains only the resulting payment intent.

## Note delivery

The payer encrypts the merchant output note with the merchant X25519 public key.

The encrypted note uses a fixed-size envelope. The fixed size reduces information leakage from payload length.

The merchant decrypts the envelope locally. The sponsor and Base never receive note plaintext.

## Public deposits and withdrawals

Deposits move a public token amount into the pool. The deposit amount and sender are visible on Base.

Withdrawals move a public token amount out of the pool. The withdrawal amount and recipient are visible on Base.

Internal payments hide the amount. A user gains a larger privacy set when many users deposit, pay, and withdraw through the same pool.

## Information available through timing

Every Base transaction has a public time and block position. GhostClaw does not hide this metadata.

An observer can compare an x402 service request with a settlement transaction. Strong timing correlation can reduce practical privacy.

Applications can reduce this signal through normal request scheduling and larger shared usage. The current protocol does not add a mandatory delay.

## Information available through gas and calldata

The proof size is fixed for each circuit. This property prevents amount-based proof-size leakage.

Payment calldata has a stable structure. The amount does not change the proof size or circuit path.

Gas use can still identify the action type. An observer can distinguish registration, deposit, payment, and withdrawal calls.

## Hosted component visibility

The sponsor sees public prepared transaction data. It can link the source network request to the submitted Base transaction.

The sponsor does not receive the spend key, note plaintext, input amount, change amount, or Merkle witness.

A merchant sees its own quote and received note. It does not see the payer input note or payer change note.

## Agent visibility

The agent receives payment status, spending limits, public account information, and the paid resource.

The agent does not receive private keys, private note data, private balance, or witness data.

The human can grant an agent a payment budget. The local wallet enforces the budget before it creates a proof.

## Privacy limits

GhostClaw does not provide these properties:

- Hidden payer identity.
- Hidden merchant identity.
- Hidden transaction time.
- Hidden action type.
- Hidden deposit amount.
- Hidden withdrawal amount.
- Protection from malware on the local machine.
- Protection from merchant-side data collection.

## Privacy by action

| Action | Public data | Confidential data |
|---|---|---|
| Identity registration | Base account, owner value, note public key | Spend key and note private key |
| Deposit | Sender, token, amount, commitment | Note blinding and note plaintext |
| Payment | Payer, merchant, commitments, nullifier, payment intent | Input amount, payment amount, change amount, note secrets |
| Withdrawal | Recipient, token, amount, nullifier | Input note amount and remaining private value |

## Practical interpretation

GhostClaw prevents the public ledger from becoming a complete price and balance database for agent commerce.

It does not make the payment invisible. It makes the payment value confidential while identity and settlement remain verifiable.

Read [x402 integration](X402.md) for request binding. Read [Base contracts](CONTRACTS.md) for the public settlement record.
