# Base Sepolia deployment

## Network

| Field | Value |
|---|---|
| Network | Base Sepolia |
| Chain ID | `84532` |
| Asset | GhostClaw Test USD, symbol `gUSD` |
| Token decimals | 6 |
| Faucet amount | 100 gUSD once per address |
| Protocol version | 2 |

The token has no market value.

## Contract addresses

| Contract | Address | Runtime bytes |
|---|---|---:|
| Pool | `0x415330497f132e8D811b80c3EB96eb15B985f3C6` | 12,558 |
| Test gUSD | `0x67A288E50AD08FCa1d8dC4f65d80640a39e48760` | 1,726 |
| Identity verifier | `0x886c99F83E741337c947586C423117E7F26a728a` | 7,234 |
| Deposit verifier | `0x70C8e535b3A0f25E0e7127F25097AaF83F8832b2` | 7,234 |
| Payment verifier | `0xBb12FB3bBdcf0e77f63b0c5a52A1C62Cd51DcbdC` | 7,234 |
| Withdrawal verifier | `0xd0ba5592E6b9443b7cdD2a71c2287eB283f59b8c` | 7,229 |
| Poseidon2 | `0xB2bFD7988D6b7695a54aC4864C4106242a4da21b` | 7,585 |

## Deployment method

The deployment used the canonical CREATE2 deployer:

```text
0x4e59b44847b379578588920cA78FbF26c0B4956C
```

Alchemy sponsored the deployment UserOperations. The deployment policy was
deactivated after completion.

Deterministic salts and init-code hashes fix every target address. The pool
init code includes all six fixed dependency addresses.

## Deployment transactions

| Contract | Block | Transaction |
|---|---:|---|
| Test gUSD | 44,999,011 | `0x770e25002461907ebf97e401a8dccc6642b3b0dd610a476179e9386fe8f86a79` |
| Identity verifier | 44,999,013 | `0xcd389e5e1c2b5fa387813ac2d74d264faf1c8825a41439f4d27b74931bdcd8e5` |
| Deposit verifier | 44,999,059 | `0xdd781c3765dbab88da70f2156f237821bd4713f807919ad10b1ade4d73bf9808` |
| Payment verifier | 44,999,060 | `0x7da2f45ed2780b8baec6c625ba6022cf24065d07b9380eb20cfb4ebe5cb8d340` |
| Withdrawal verifier | 44,999,061 | `0x13d3759f2a52d5836fe28335e85041c47a98f49ffb3f081a895b45d1e46bed7c` |
| Poseidon2 | 44,999,062 | `0xd10da553576ddb5a2faaf5f9a38071370ccf0c2241019d151e4fd659aefb9c8b` |
| Pool | 44,999,064 | `0xab297ea8c9bb40b301f5e2509a9b936d2406a4663a8855f1e3fed620e6d4b8dc` |

## Runtime hashes

| Contract | Keccak-256 runtime hash |
|---|---|
| Test gUSD | `0x47326a4fff0b37a672ada529bae9e1a1459271d47e50796a56cb4041df5f55fb` |
| Identity verifier | `0x3476c585fd48de305133b7d962196d90a4bef2c444fe5b072f837fe63e0a3260` |
| Deposit verifier | `0xae2c044d83ab5fd5163075e8df58dee7b8c80a6346e3755a84faf71e55ccd1e6` |
| Payment verifier | `0x27ae3bb245686b6731911ebcf9c2760cdee8d6189e10de514b29efa0e4b4e757` |
| Withdrawal verifier | `0x978985616131fdfee5d35001574acf8dad96db9f502a70440f99256e8b62352e` |
| Poseidon2 | `0x9d60f1447bfdfe1214a05574c13834688502d523dd76334b33d808473c5e7b97` |
| Pool | `0x71a85f494ad319d4a0c88dbf5b822a8671095a70577cd8d52e513703e37e8104` |

## Independent verification

The preflight script got runtime code through the configured Alchemy RPC and a
separate public Base Sepolia RPC. Both endpoints returned matching code.

The script checked the canonical CREATE2 deployer. It checked the Ignition file
digest and local setup manifest. It also materialized the pool immutable values
before it compared the expected runtime.

The records are:

```text
deployments/base-sepolia-v2.json
deployments/base-sepolia-v2-preflight.json
```

The live verification record adds pool wiring, relay health, and the pinned
Alchemy delegation runtime.

## Pool configuration

The deployed pool reports its own address as `context()`. Its immutable fields
match every address in this document.

The initial root is the depth-20 empty Poseidon2 root. The pool retains 256
recent roots and supports 1,048,576 leaf positions.

## Public sponsored relay

The relay origin is:

```text
https://ghostclaw-confidential-payments.vercel.app
```

The active Alchemy Gas Manager policy applies the custom callback at:

```text
https://ghostclaw-confidential-payments.vercel.app/alchemy/sponsor
```

The policy sponsors only the listed pool and test-token functions. The relay
uses shared Redis limits and an independent Base simulation.

## Verify the live deployment

Run:

```sh
npm run verify:live
```

The command checks relay health, unsupported-method rejection, all seven
contract runtimes, pool wiring, and the pinned EIP-7702 delegation runtime.

## Testnet limit

This deployment is a public integration environment. It is not a production
asset pool. An independent audit of the final signed release remains required.
