# Sponsored relay

## Purpose

The hosted relay gives a new Base Sepolia user a gas-free GhostClaw flow. It
keeps the Alchemy application key and Gas Manager policy ID on the server.

The relay does not hold user transaction keys. The local wallet signs every
prepared operation.

## Public routes

| Route | Method | Purpose |
|---|---|---|
| `/health` | GET | Checks the relay configuration and shared Redis store. |
| `/rpc` | POST | Proxies three Alchemy Wallet API methods. |
| `/alchemy/sponsor` | POST | Applies the custom Gas Manager rule. |

The public origin is:

```text
https://ghostclaw-confidential-payments.vercel.app
```

## Wallet API policy

`/rpc` accepts these methods:

```text
wallet_prepareCalls
wallet_sendPreparedCalls
wallet_getCallsStatus
```

The relay rejects another JSON-RPC method.

The preparation request must target Base Sepolia. It must contain one to three
approved calls. An emergency undelegation request contains no contract call.

The relay adds the Alchemy transaction policy and callback secret. A client
cannot select another policy.

Emergency undelegation uses a separate Bundler Sponsored Operations policy.
The relay permits only a signed EIP-7702 authorization to the zero address.
The relay adds this policy during preparation and submission.

## Approved contract calls

The relay permits these pool functions:

```text
registerSelf
rotateAccount
requestRecovery
cancelRecovery
finalizeRecovery
deposit
confidentialTransfer
withdraw
```

It permits these test token functions:

```text
faucet
approve
```

The token approval spender must equal the GhostClaw pool. Every native token
value must equal zero. Proof-bearing calls must contain exactly 768 proof bytes.

The relay checks field ranges, unsigned 64-bit amounts, addresses, signatures,
and deadlines before it contacts Alchemy.

## Signed-operation checks

The relay decodes the Alchemy Modular Account v2 call data. It checks the Base
sender and every inner call.

It recalculates the EntryPoint v0.7 UserOperation hash. It recovers the local
signature and compares the signer with the sender.

When an EIP-7702 authorization exists, the relay recovers that signature too.
The delegation target must equal the pinned Alchemy Modular Account v2 address.

## Sponsorship callback

The relay injects a random secret into `paymasterService.webhookData`. Alchemy
returns this value to `/alchemy/sponsor`.

The callback compares the value with a server secret. It checks the policy ID,
chain, sender, inner calls, targets, proof sizes, amounts, and native value.

The callback returns only this decision shape:

```json
{ "approved": true }
```

or:

```json
{ "approved": false }
```

The callback does not return a detailed rejection reason to Alchemy.

The server records a short security event after a callback rejection. The
event contains the failed stage and a fixed reason. It excludes addresses, IP
data, call data, proof bytes, amounts, and secrets.

## Independent simulation

An approved sponsorship request receives an `eth_call` simulation through a
separate Base Sepolia RPC. The simulation uses the UserOperation sender as the
call origin.

A revert, timeout, malformed result, or RPC failure causes rejection. The
Alchemy policy also rejects callback timeout and callback error.

## Shared rate limits

All Vercel instances use one Redis-compatible REST store. One Lua command
checks and increments all applicable counters atomically.

The limits use a 60-second window:

| Scope | Weighted units |
|---|---:|
| Global authorized load | 600 |
| One method and route | 600 |
| Status method and route | 1,200 |
| One IP | 180 |
| One sender | 120 |
| Raw route preflight for one IP | 120 requests |

Identity, faucet, approval, and recovery calls use one unit. Deposit, payment,
and withdrawal calls use ten units.

Redis keys store HMAC values for IP and sender data. The HMAC secret stays in
the Vercel environment.

The relay returns `503` when Redis is unavailable. It does not use a local
counter as a hosted fallback.

`/health` sends a Redis `PING`. It returns `503` when configuration, credentials,
or Redis availability checks fail.

## Vercel firewall

The Vercel firewall applies an additional IP rule to `/rpc` and
`/alchemy/sponsor`. It allows 100 requests per 60 seconds from one IP. It returns
HTTP 429 after the limit.

The application limit remains the main sender-aware control.

## Alchemy policy

The active transaction policy uses the custom sponsorship callback. Callback
error and timeout sponsorship are disabled.

The active emergency policy has separate dollar and transaction limits. It
sponsors only the relay-approved zero-address authorization.

Gas Manager hard limits cap total sponsorship. The operator monitor reads
recent sponsorship records. It can set the complete policy to inactive after a
cost spike, sender spike, or high failure rate.

## Required hosted secrets

The Vercel project needs these values:

```text
ALCHEMY_API_KEY
ALCHEMY_AGENT_GAS_POLICY_ID
ALCHEMY_UNDELEGATION_GAS_POLICY_ID
GHOSTCLAW_SPONSOR_CALLBACK_TOKEN
GHOSTCLAW_RATE_LIMIT_KEY_SECRET
GHOSTCLAW_SIMULATION_RPC_URL
UPSTASH_REDIS_REST_KV_REST_API_URL
UPSTASH_REDIS_REST_KV_REST_API_TOKEN
```

Standard Vercel KV names, direct Upstash names, and explicit
`GHOSTCLAW_RATE_LIMIT_REDIS_*` names are also supported. The explicit
GhostClaw names have first priority.

Do not place secret values in a release archive, log, issue, or audit bundle.

## Local operator relay

An operator can run the same policy outside Vercel:

```sh
npm run relay
```

The local server requires the same shared Redis store as the hosted relay.

## Fail-closed behavior

The relay stops a request when any required safety dependency fails. This rule
applies to Redis, Base simulation, callback authentication, call decoding,
signature recovery, Alchemy response checks, and response size checks.

## Data visible to the relay

The relay sees public account addresses, function selectors, commitments,
nullifiers, proof bytes, timing, and source IP data. The payment amount stays
inside the proof witness.

The relay can correlate network timing with a public payer. Use a separate
network privacy layer if that metadata is sensitive.
