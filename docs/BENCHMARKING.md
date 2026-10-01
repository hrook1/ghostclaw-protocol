# Local benchmark guide

## Purpose

The local benchmark measures circuit proof creation and native verification. It
uses deterministic test notes. It does not use wallet keys or Base credentials.

## Requirements

Install Bash, Git, and Go 1.25.12 or later. Use macOS, Linux, or WSL 2. Give the
proof process at least 8 GiB of memory.

The first run downloads the fixed modules in `go.mod` and `go.sum`.

## Run the benchmark

From the repository root, run:

```sh
./scripts/benchmark-local.sh --iterations 20
```

Use more samples for a machine comparison:

```sh
./scripts/benchmark-local.sh --iterations 50
```

Use one sample for a short functional check:

```sh
./scripts/benchmark-local.sh --iterations 1
```

## Command stages

The script performs these steps:

1. Check Go 1.25.12 or later.
2. Check the Ignition SRS SHA-256 value.
3. Download fixed Go modules.
4. Create fresh proof artifacts.
5. Run all Go tests.
6. Create and verify each proof sample.
7. Write the JSON result and host information.

Setup and compilation time stay outside each proof sample.

## Output files

```text
benchmark-results/latest-local.json
benchmark-results/local-environment.txt
```

Git ignores these machine-specific outputs. The release reference result is:

```text
benchmark-results/native-proving.json
```

## JSON fields

| Field | Meaning |
|---|---|
| `protocol` | Contract proof protocol version. |
| `platform` | Go operating system and architecture. |
| `goVersion` | Go runtime version. |
| `iterations` | Samples for each circuit. |
| `circuits.identity` | Identity proof measurements. |
| `circuits.deposit` | Deposit proof measurements. |
| `circuits.spend` | Confidential payment proof measurements. |
| `circuits.withdraw` | Withdrawal proof measurements. |
| `proofBytes` | Proof byte length. |
| `proveMs` | Proof creation statistics. |
| `verifyMs` | Native verification statistics. |
| `generatedAt` | UTC completion time. |

Use `circuits.spend.proveMs.median` for a normal local x402 proof time. Use P95
when you plan an agent timeout.

## Reference result

| Circuit | Constraints | Proof bytes | Median | P95 |
|---|---:|---:|---:|---:|
| Identity | 2,392 | 768 | 125.924 ms | 178.043 ms |
| Deposit | 2,787 | 768 | 130.787 ms | 175.707 ms |
| Payment | 17,145 | 768 | 782.863 ms | 838.869 ms |
| Withdrawal | 13,776 | 768 | 422.360 ms | 463.344 ms |

The reference host reported `darwin/amd64` and Go `1.25.12`. Processor load,
available memory, and thermal control affect proof time.

## Stable comparison method

Use the same Go version on each machine. Run at least 20 samples after the first
module download. Record both output files.

Keep other high-load tasks closed during the run. Connect portable machines to
power when their operating system reduces performance on battery.

## Public parameter check

The script requires this SHA-256 value:

```text
3718ffbed583d8a279ccb2545196d5618e3fd97512b65aa051d2ebd0f57fb999
```

The Go loader also checks curve points, subgroup membership, the generator, tau
G2, and five pairing relations.

## Contract measurements

The local benchmark does not measure Base gas or confirmation time. The live
fresh-wallet test records those values in:

```text
benchmark-results/base-sepolia-v2-e2e.json
```

Read [BENCHMARKS.md](BENCHMARKS.md) for the combined result.
