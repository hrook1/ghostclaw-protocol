# Package acceptance test

Date: 2026-08-07

Version: `1.5.0`

Network: Base Sepolia

## Scope

This test used an empty temporary directory on an Intel Mac.

The test installed the packed `ghostclaw` package and its Intel prover package.
It used Node.js 22.23.2. The machine did not build the prover during setup.

The test used the pinned proving files through `GHOSTCLAW_ARTIFACT_DIR` because
version `1.5.0` was not published during this test.

The paid route used the same merchant and facilitator handlers as the Vercel
deployment. A temporary loopback server hosted those handlers. Base Sepolia,
the sponsored relay, the deployed contracts, and the demo merchant identity
were live.

## Observed result

1. npm installed 163 packages and found zero vulnerabilities.
2. `ghostclaw init` created and registered a new wallet.
3. The relay sponsored the registration transaction.
4. `ghostclaw claim` delivered 100 valueless public test gUSD.
5. `ghostclaw deposit --amount 100` created a local proof and confirmed the deposit.
6. The wallet reported one private note with a balance of 100.
7. The installed library bought the address report for 1 private test gUSD.
8. Base Sepolia confirmed the confidential payment.
9. The merchant verified the public settlement and decrypted its received note.
10. The route returned the report and a durable delivery URL.
11. The delivery URL returned the same report without another payment.
12. The payer wallet reported a private balance of 99.
13. All temporary local servers were stopped after the test.

## Base evidence

Wallet registration transaction:

```text
0x7fb2722cc14e65fd3aee0f2c86bd988948b0e8bcc5d61d6b32bc122dd548da79
```

Test-asset claim transaction:

```text
0xc8157192bc7f4d2203660616fbbcac641ea5b2424971cfbd5731b5375035779f
```

Private deposit transaction:

```text
0x1ad5f30d31bec2c33f09313ba5a7297db51a67d11fd4d3243841188e4dd67fb2
```

Confidential x402 payment transaction:

```text
0x037c9261a46d9c618dc88339876dd33387807a00eb0170f76b3a50de1530c42c
```

The test wallet address was:

```text
0xCa5355F50077c523ae1724aD540E9494018ac5C1
```

## Installed prover benchmark

The benchmark ran three times for each circuit.

| Circuit | Median local proof time | Proof size |
|---|---:|---:|
| Deposit | 109.730 ms | 768 bytes |
| Identity | 106.853 ms | 768 bytes |
| Spend | 693.729 ms | 768 bytes |
| Withdrawal | 410.775 ms | 768 bytes |

Platform: `darwin/amd64`

## Hosted release gate

This test proves the package and Base Sepolia transaction path. The public npm
install and hosted paid route still require the release-owner actions recorded
in `docs/PACKAGE_DISTRIBUTION.md`.

Run this check after the production Vercel deployment:

```sh
npm run verify:live
```

The check requires the relay, facilitator, paid demo, proving-file pin,
contract wiring, and delegation runtime to match the release.
