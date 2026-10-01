# Local proving

## Proof backend

GhostClaw uses Consensys gnark `v0.15.0`. The backend is PLONK with KZG
commitments on BN254.

The EVM verifies each proof through the BN254 precompiles. Proof size is 768
bytes for every circuit in this release.

## Public proof parameters

The prover uses the Aztec Ignition universal structured reference string. The
source repository includes the required G1 prefix at:

```text
public-parameters/bn254_g1.dat
```

Expected SHA-256:

```text
3718ffbed583d8a279ccb2545196d5618e3fd97512b65aa051d2ebd0f57fb999
```

The loader checks the file digest. It checks curve points, subgroup membership,
the generator, tau G2, and five pairing relations.

GhostClaw did not run a project-specific trusted ceremony. The Ignition
security assumption still applies. At least one contributor must have destroyed
its secret contribution.

The npm package downloads the SRS prefix and circuit artifacts on first use.
The one-time download is 12.5 MiB. The expected hashes are compiled into
`scripts/lib/artifact-manifest.mjs`.

Set `GHOSTCLAW_ARTIFACT_DIR` to an absolute local directory for offline use.

## Deterministic setup

Run:

```sh
go run ./cmd/ghostclaw-prover setup \
  --ignition-g1 public-parameters/bn254_g1.dat \
  --artifacts artifacts \
  --verifiers generated
```

The command compiles the four circuits. It derives each proving key and
verification key from the fixed public parameters. It exports the Solidity
verifiers.

The manifest uses a fixed generation time. gnark emits deterministic verifier
values with non-canonical whitespace. The release check formats the temporary
verifiers before it compares their bytes.

Run the complete reproduction check:

```sh
npm run verify:artifacts
```

The command must report an exact match for all artifacts and verifiers.

## Artifact checks

The local wallet checks these values before it creates a proof:

- Backend and curve.
- gnark version.
- Ignition digest.
- Circuit constraint counts.
- Circuit public input counts.
- Proving key, verification key, and constraint-system hashes.
- Secure file type, owner, and permissions.

A failed check stops the wallet.

## Private witness input

The Node runtime sends each witness through standard input. It does not put
private witness values in command arguments.

The Go command writes the proof result through standard output. The Node runtime
limits output size. It reports one generic error when the prover rejects a
witness.

The payment command receives private amount data through standard input. This
design keeps the amount out of the process list and normal shell history.

## Process limits

The runtime builds a small operating-system limiter with the prover.

| Limit | Value |
|---|---:|
| Hard process memory | 8 GiB |
| Go soft memory | 6 GiB |
| Command time | 120 seconds |
| Standard output | 2 MiB |
| Standard error | 128 KiB |

The limiter uses `setrlimit` on macOS and Linux. Windows uses a Job Object with
a process memory limit and child-process termination.

The runtime terminates the complete proof process group after a timeout or
output overflow.

## Commands

The prover supports these commands:

```text
setup
owner
tree-witness
inspect-received-payment
prove-identity
prove-deposit
prove-payment
prove-withdrawal
prove-scenario
benchmark
```

Dynamic proof commands accept JSON from standard input. They validate addresses,
field values, unsigned 64-bit amounts, note commitments, path data, and output
positions before circuit assignment.

## Local benchmark

Run:

```sh
./scripts/benchmark-local.sh --iterations 20
```

The command verifies the Ignition file. It creates fresh setup artifacts. It
runs the Go tests. It then measures proof creation and native verification.

Setup time stays outside each proof sample. The benchmark verifies every proof
before it records the sample.

The current reference measurement is:

| Circuit | Constraints | Median | P95 |
|---|---:|---:|---:|
| Identity | 2,392 | 125.924 ms | 178.043 ms |
| Deposit | 2,787 | 130.787 ms | 175.707 ms |
| Payment | 17,145 | 782.863 ms | 838.869 ms |
| Withdrawal | 13,776 | 422.360 ms | 463.344 ms |

The reference host reported `darwin/amd64` with Go `1.25.12`. CPU load and
thermal limits can change local results.

## Base verifier

gnark exports one Solidity verifier for each circuit. The pool sends public
inputs in the exact circuit order.

The generated verifier returns `true` for a valid proof. It reverts or returns
`false` for an invalid proof. The pool converts either invalid result into
`InvalidProof`.

The deployment record includes each verifier runtime hash. An independent Base
RPC matched every deployed hash.
