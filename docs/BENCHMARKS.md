# Benchmarks

Measurement date: 2026-08-03

Network: Base Sepolia, chain ID `84532`

Security stage: public testnet evaluation

## Local proof measurement

The reference host reported `darwin/amd64` with Go `1.25.12`. The command
created and verified 20 proofs for each circuit. Setup and compilation stayed
outside each proof sample.

| Action | Constraints | Proof size | Median | P95 | Mean |
|---|---:|---:|---:|---:|---:|
| Identity | 2,392 | 768 bytes | 0.126 s | 0.178 s | 0.132 s |
| Deposit | 2,787 | 768 bytes | 0.131 s | 0.176 s | 0.137 s |
| Confidential payment | 17,145 | 768 bytes | 0.783 s | 0.839 s | 0.786 s |
| Withdrawal | 13,776 | 768 bytes | 0.422 s | 0.463 s | 0.431 s |

Machine-readable data is in `benchmark-results/native-proving.json`.

## Contract size

EIP-170 limits deployed runtime bytecode to 24,576 bytes.

| Contract | Runtime size | Remaining margin |
|---|---:|---:|
| Pool | 12,558 bytes | 12,018 bytes |
| Test gUSD | 1,726 bytes | 22,850 bytes |
| Identity verifier | 7,234 bytes | 17,342 bytes |
| Deposit verifier | 7,234 bytes | 17,342 bytes |
| Confidential payment verifier | 7,234 bytes | 17,342 bytes |
| Withdrawal verifier | 7,229 bytes | 17,347 bytes |
| Poseidon2 | 7,585 bytes | 16,991 bytes |

The deployed runtime hashes match the local build through two Base Sepolia RPC
sources.

## Live Base measurement

The hosted run used two fresh wallets. Alchemy sponsored every transaction.

| Action | Complete gas | Proof time | Confirmation | Mainnet fee equivalent |
|---|---:|---:|---:|---:|
| Deposit | 1,132,739 | 0.165 s | 3.667 s | $0.01084 |
| Confidential payment | 1,195,268 | 0.834 s | 3.499 s | $0.01145 |
| Withdrawal | 1,302,449 | 0.557 s | 3.619 s | $0.01245 |

The fee estimate uses an ETH price of $1,855.235. The quote time was
2026-08-04T10:26:41Z. The testnet user paid no gas.

Direct verifier gas was 302,650 for deposit, 312,279 for payment, and 307,435
for withdrawal. Contract state updates and wallet overhead use the remaining
gas.

The merchant accepted the encrypted note. A second import of the same note
failed. The independent RPC confirmed the roots, nullifiers, payment intent,
contract code, and escrow balance.

Each run creates fresh private identities. The prover rebuilds the current
public note tree before it creates a proof.

## Fee interpretation

Alchemy pays the Base Sepolia transaction fee. Testnet ETH and test gUSD have no
market value.

The report also calculates a mainnet fee equivalent from the recorded ETH fee
and a dated ETH/USD quote. This value is an estimate. Base execution fees,
Ethereum data fees, calldata, and ETH price change over time.

## Evidence files

| File | Content |
|---|---|
| `benchmark-results/native-proving.json` | Current 20-sample local proof report. |
| `benchmark-results/base-sepolia-v2-e2e.json` | Hosted fresh-wallet Base result. |
| `deployments/base-sepolia-v2.json` | Addresses and runtime evidence. |
| `deployments/base-sepolia-v2-preflight.json` | Independent pre-deployment checks. |
| `deployments/base-sepolia-v2-verified.json` | Independent live state checks. |
| `deployments/base-sepolia-v2-proofs.json` | Proofs and public inputs for the live run. |
