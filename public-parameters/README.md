# Public parameters

`bn254_g1.dat` contains public BN254 G1 points from the Aztec Ignition universal
setup.

| Property | Value |
|---|---:|
| File size | 8,388,608 bytes |
| Encoded G1 points | 131,072 |
| Bytes per point | 64 |

SHA-256:

```text
3718ffbed583d8a279ccb2545196d5618e3fd97512b65aa051d2ebd0f57fb999
```

This file is public proof-system data. Wallet secrets, proving witnesses, and
Ignition contribution secrets live outside it.

`internal/ignition/srs.go` checks the file size and digest. It also validates
loaded points, subgroup membership, the generator, tau G2, and pairing
relations.

Read [the proving guide](../docs/PROVING.md) for the setup procedure. Read
[the security guide](../docs/SECURITY.md) for the trust assumption.
