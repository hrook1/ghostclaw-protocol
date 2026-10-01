# Payment flow

This page describes one confidential x402 payment from the first service request to final delivery.

The flow uses one local wallet, one merchant service, one transaction adapter, and the GhostClaw contracts on Base.

:::diagram Complete payment path
Request|The agent requests a merchant resource.
Quote|The merchant returns an x402 payment requirement.
Validate|The local wallet checks the quote and spending policy.
Prove|The local proof runtime creates the payment proof.
Settle|Base verifies the proof and updates the pool.
Deliver|The merchant verifies settlement and returns the resource.
:::

## Actors

| Actor | Responsibility |
|---|---|
| Agent | Selects the service and starts the request |
| MCP server | Gives the agent a controlled payment tool |
| Local wallet | Validates the quote, selects a note, and controls keys |
| Proof runtime | Creates the zero-knowledge proof |
| Transaction adapter | Submits the prepared Base call |
| Sponsor | Pays gas for an approved call when sponsorship is active |
| Pool contract | Verifies the proof and records the state change |
| Merchant | Validates settlement and delivers the resource |

## Step 1: The agent requests a resource

The agent calls `ghostclaw_fetch` with a URL, HTTP method, headers, and optional request body.

The MCP server sends the HTTP request without payment data. A public resource can return immediately.

A paid resource returns HTTP `402 Payment Required`. The response contains the x402 payment requirement.

The local wallet keeps the original request. It will retry the same request after settlement.

## Step 2: The merchant creates the requirement

The merchant requirement identifies one exact payment.

It contains these logical fields:

| Field | Purpose |
|---|---|
| Scheme | Selects the GhostClaw confidential x402 method |
| Network | Identifies Base and the required chain |
| Asset | Identifies the accepted token |
| Pool | Identifies the GhostClaw pool contract |
| Merchant | Identifies the registered merchant account |
| Amount | States the quoted price to the payer |
| Resource | Binds payment to the requested resource |
| Request digest | Binds method, URL, and request body |
| Expiry | Limits the quote lifetime |
| Nonce | Makes the requirement unique |
| Note key | Encrypts the merchant output note |

The merchant signs or authenticates the requirement through its service context. The client also binds it to the TLS origin.

## Step 3: The wallet validates the requirement

The local wallet rejects a requirement that does not match the original request.

It checks these values:

1. The URL uses an allowed origin.
2. The scheme matches the supported GhostClaw scheme.
3. The chain matches the configured Base network.
4. The asset matches the configured pool asset.
5. The pool matches the configured GhostClaw pool.
6. The merchant has a current GhostClaw identity.
7. The merchant note key matches the current identity record.
8. The amount is within the user payment limit.
9. The amount is within the remaining session limit.
10. The amount is within the remaining daily limit.
11. The merchant passes the allowlist and denylist rules.
12. The requirement has not expired.
13. The request digest matches the saved request.

The wallet stops before proof creation if one check fails.

## Step 4: The wallet selects an input note

The wallet synchronizes its local commitment state with Base. It marks only confirmed notes as available.

The wallet selects an available note that is larger than the payment amount. The current payment circuit requires positive change.

For an input amount `I` and payment amount `P`, the wallet calculates change `C`:

```text
I = P + C
P > 0
C > 0
```

The wallet creates fresh random blindings for the merchant note and change note. It also randomizes the output order.

## Step 5: The wallet binds the request

The wallet creates a random 256-bit salt. It combines the salt with the normalized request data.

The resulting digest becomes the payment intent. The circuit includes this payment intent as a public input.

The salt prevents a public observer from testing likely request values against the public digest.

The merchant receives the salt in the private payment response. It recomputes the digest during settlement validation.

## Step 6: The proof runtime creates the proof

The wallet sends one private witness to the local proof runtime.

The witness contains:

- Input note amount.
- Spend key.
- Input note blinding.
- Merkle path and path direction bits.
- Payment amount.
- Merchant note blinding.
- Change note blinding.
- Output position selector.
- Salted x402 request data.

The runtime checks all circuit constraints. It outputs the proof and public inputs.

The public inputs contain the accepted root, nullifier, output commitments, payer, merchant, owner values, context, and payment intent.

The proof does not contain readable private witness values.

## Step 7: The wallet encrypts the merchant note

The payer wallet creates the merchant note plaintext. It includes the amount, owner, blinding, commitment, and protocol context.

The wallet encrypts this note with the merchant X25519 public key. It places the ciphertext in a fixed-size envelope.

The encrypted note travels with the private payment response. It does not enter the Base transaction.

## Step 8: The transaction adapter prepares the Base call

The adapter creates one `confidentialTransfer` call for the pool contract.

The prepared call contains only public protocol data:

- Proof bytes.
- Public input values.
- Payer and merchant accounts.
- Payment intent.
- Output commitments.

The adapter estimates gas and simulates the call. A failed simulation stops submission.

## Step 9: The adapter submits the transaction

In direct mode, the local Base account signs and submits the transaction.

In sponsored mode, the adapter sends the prepared transaction to the sponsor. The sponsor checks its contract and function policy.

The sponsor pays the Base gas and submits the same prepared call. It cannot change the proof or public inputs without making verification fail.

## Step 10: Base verifies settlement

The pool contract performs the public state checks before and after proof verification.

It checks:

1. The payer and merchant have active identities.
2. The supplied owner values match those identities.
3. The spend root is in the recent-root history.
4. The nullifier has not been used.
5. The payment intent has not been used.
6. The output commitments are valid field values.
7. The payment verifier accepts the proof.

The contract then records the nullifier and payment intent. It appends both output commitments to the tree.

The pool emits an x402 settlement event. The event identifies the payer, merchant, intent, commitments, nullifier, and new root.

The event does not include the payment amount.

## Step 11: The merchant validates settlement

The merchant waits for the transaction receipt. It then validates the receipt against its saved requirement.

The merchant checks these items:

1. The transaction succeeded on the required chain.
2. The transaction called the configured pool.
3. The call used the expected payment function.
4. The receipt contains one matching settlement event.
5. The payer and merchant match the requirement.
6. The payment intent matches the salted request digest.
7. The output commitments match the payment response.
8. The new root contains the merchant commitment.
9. The transaction has not been accepted for another delivery.
10. The requirement has not expired under the merchant policy.

The merchant decrypts the output note. It verifies the amount, owner, blinding, and commitment.

The merchant stores the note as pending. It makes the note available after local chain synchronization confirms its witness.

## Step 12: The merchant delivers the resource

The merchant returns the requested resource when delivery is immediate.

A long-running service returns a durable job handle. The handle lets the payer retrieve the result without another payment.

The client stores the settlement response before it retries the original request. This order supports recovery after a local interruption.

## Durable delivery

A durable job separates final payment from delayed work.

:::diagram Durable service delivery
Settlement|The merchant accepts one final Base payment.
Job record|The merchant creates a durable result identifier.
Processing|The service performs the requested work.
Retrieval|The payer uses the identifier to fetch the result.
:::

The merchant must make result retrieval idempotent. **Idempotent** means that repeated retrieval gives the same result without another charge.

The payer must not create a second payment when delivery fails after settlement. It must use the saved delivery handle.

## Retry rules

| Failure point | Safe action | Payment state |
|---|---|---|
| Before proof creation | Repeat the request | No payment exists |
| During proof creation | Restart proof creation | No payment exists |
| Before transaction submission | Resubmit the prepared action after validation | No settlement exists |
| Unknown transaction status | Check Base by transaction hash and payment intent | Settlement can exist |
| After successful settlement | Use the saved delivery handle | Payment is final |
| During result retrieval | Repeat retrieval with the same handle | No new payment |

## Privacy through the flow

The agent sees the quote and final resource. The wallet sees all payment details.

The sponsor sees the public prepared transaction. Base sees the public state transition.

The merchant sees the quoted amount and its decrypted output note. A public observer sees the identities and settlement metadata.

## Result

The flow produces one Base settlement, two new note commitments, one spent-note nullifier, and one merchant delivery record.

Read [x402 integration](X402.md) for the HTTP exchange. Read [Base contracts](CONTRACTS.md) for the onchain checks.
