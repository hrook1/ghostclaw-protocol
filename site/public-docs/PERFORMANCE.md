# Performance

GhostClaw performance has two independent parts. The local machine creates the proof. Base verifies the proof and updates protocol state.

Proof size, proving time, verification gas, state-update gas, network fees, and confirmation time measure different parts of the system.

## Measurement scope

The values on this page describe the current public test environment. They are engineering measurements, not fixed protocol guarantees.

Local proving time changes with processor speed, operating system, runtime load, and thermal limits.

Base fees change with L1 data cost, Base demand, ETH price, and transaction calldata.

## Proof measurements

| Circuit | Constraints | Proof size | Typical local use |
|---|---:|---:|---|
| Identity | 2,392 | 768 bytes | Registration and account actions |
| Deposit | 2,787 | 768 bytes | Public token deposit |
| Payment | 17,145 | 768 bytes | Confidential x402 settlement |
| Withdrawal | 13,776 | 768 bytes | Public token withdrawal |

The proof size stays fixed because PLONK uses a succinct proof. A larger private amount does not create a larger proof.

The payment circuit has the largest constraint count. It proves membership, ownership, conservation, request binding, and two output commitments.

## Local proving stages

:::diagram Local proving latency
Load artifacts|The runtime loads circuit and proving data.
Build witness|The wallet converts action data into circuit inputs.
Solve circuit|The prover computes the complete constraint witness.
Create proof|PLONK creates commitments and opening proofs.
Serialize|The runtime returns proof bytes and public inputs.
:::

Warm execution can reuse operating-system file caches. Cold execution includes additional artifact and process startup time.

The first proof after installation can therefore take longer than later proofs.

## Observed local range

Current test measurements place simple identity and deposit proofs near the low single-digit second range on modern desktop hardware.

Payment and withdrawal proofs take more work. Current target behavior keeps the payment proof within the interactive local-use range.

For product planning, use this conservative range:

| Action | Expected modern desktop range |
|---|---:|
| Identity | About 1 to 3 seconds |
| Deposit | About 1 to 3 seconds |
| Payment | About 2 to 5 seconds |
| Withdrawal | About 2 to 5 seconds |

These ranges exclude Base confirmation and merchant processing. Run the packaged benchmark on the target machine before capacity planning.

## Proof time factors

These factors can increase proof time:

- Low-power or older processor.
- x86 emulation on an ARM host.
- Cold file cache.
- Limited available memory.
- Concurrent CPU-heavy work.
- Virtual-machine CPU limits.
- Thermal throttling.

The proof uses local CPU and memory. It does not require a GPU.

## Base transaction work

A confidential payment transaction performs three main jobs:

1. It verifies the PLONK proof.
2. It checks shared pool state.
3. It inserts two output commitments into the Merkle tree.

Proof verification is the largest cryptographic cost. Tree insertion is also material because Poseidon2 hashing runs at each tree level.

## Gas composition

The current payment design uses approximately this high-level gas shape:

| Work | Approximate share | Reason |
|---|---:|---|
| PLONK verification | 55 to 60% | Elliptic-curve and pairing operations |
| Commitment insertion | 35 to 40% | Poseidon2 hashes and storage updates |
| Other call work | 5 to 10% | Identity checks, nullifier, intent, event, and calldata |

The exact split changes with compiler output and circuit public inputs.

## Why insertion costs gas

The pool must update its public commitment root after each payment. This update makes the merchant note available for a later spend.

The contract hashes the two new leaves through the depth-20 tree. It also stores the leaf pair, root, nullifier, and payment intent.

This work is separate from proof verification. A cheaper verifier would not remove the state-update cost.

## Transaction gas range

Current engineering measurements place a direct confidential payment near several million gas on Base.

The working reference range is approximately 2.9 million to 4.5 million gas, depending on the insertion path and measured build.

Use a live estimate from the deployed contract for each release candidate. Do not convert this gas range into a fixed dollar promise.

## Fee calculation

Base transaction cost has execution and L1 data components.

The simplified calculation is:

```text
total fee = Base execution fee + L1 data fee
USD cost = total fee in ETH × current ETH price
```

Proof size affects calldata and L1 data cost. Verification work and state insertion affect execution gas.

Increasing proof size does not reduce the current insertion work. It usually increases calldata cost.

## Historical fee examples

During low-fee Base conditions, measured GhostClaw-style transactions have been in the low-cent range.

Observed planning examples placed a direct confidential payment near three to five US cents. This value changes with Base and Ethereum fees.

These examples are not a fee guarantee. Query the network before a production payment.

## Settlement latency

Total payment time includes local proving, transaction submission, Base inclusion, merchant confirmation policy, and service processing.

:::diagram End-to-end latency
Quote validation|Local policy and requirement checks.
Proof creation|Local CPU work.
Submission|Direct or sponsored transaction request.
Base inclusion|The sequencer includes the transaction.
Delivery|The merchant verifies and returns the resource.
:::

A fast local proof does not guarantee immediate delivery. The merchant can require additional confirmations for higher-value services.

## Sponsored transaction overhead

Sponsorship adds a network request, policy evaluation, simulation, and sponsor submission.

This overhead is usually small compared with local proof creation and Base inclusion. It can increase during sponsor congestion.

Sponsorship changes who pays gas. It does not reduce contract gas use.

## No batching in the current payment path

The direct payment path settles one user payment in one Base transaction. It does not require an offchain proof aggregator.

This design gives direct settlement and simpler failure handling. It pays proof verification and state insertion for each payment.

A future batch design could amortize state insertion or verification. It would add pending time, batch coordination, and more complex delivery rules.

## Performance trade-offs

| Choice | Benefit | Cost |
|---|---|---|
| Local proof creation | Private witness stays local | User machine performs CPU work |
| Onchain verification | Base enforces validity | Verification uses significant gas |
| Per-payment insertion | Merchant note becomes directly available | Each payment updates contract state |
| Recent-root history | Supports concurrent local proofs | Contract stores and manages more roots |
| Fixed proof size | Stable calldata shape | Circuit changes do not reduce proof bytes |
| Direct settlement | Simple receipt and delivery path | No batch amortization |

## Benchmark method

A useful benchmark must record the complete environment.

Record these values:

- Client version.
- Prover binary identity.
- Circuit identity.
- Operating system and architecture.
- Processor model.
- Available memory.
- Cold or warm run.
- Iteration count.
- Median proving time.
- Slowest proving time.
- Proof size.
- Base gas estimate.
- Base receipt gas used.

Use at least three warm iterations for a quick comparison. Use more iterations for capacity planning.

## Interpreting a benchmark

Use the median to describe normal proving time. Use the slowest result to plan user timeouts.

Do not combine local proving time with Base confirmation time. Report both values separately.

Do not compare an emulated virtual machine with a native build without identifying the emulation.

## Current optimization priorities

Optimization must preserve the privacy model and proof validity.

The most useful areas are:

- Reduce local process startup and artifact-loading time.
- Keep native prover binaries for each supported architecture.
- Reduce duplicate local synchronization work.
- Use paired commitment insertion efficiently.
- Keep public calldata compact.
- Measure verifier changes before changing proof systems.

Proof aggregation becomes useful when payment volume can amortize its coordination cost. The direct path remains the reference behavior.

## Performance limits

The public test environment does not prove production capacity. It measures one implementation under test conditions.

Production planning also needs concurrent-wallet tests, sponsor capacity tests, merchant delivery tests, and long-running state synchronization tests.

Read [Local proving](PROVING.md) for circuit structure. Read [Base contracts](CONTRACTS.md) for tree insertion and verifier work.
