# Alchemy Modular Account v2 Assurance Record

GhostClaw accepts this EIP-7702 delegation contract:

```text
Name: SemiModularAccount7702
Version: v2.0.0
Address: 0x69007702764179f14F51cdce752f4f775d74E139
Runtime bytes: 23741
Runtime code hash: 0xecfc0328ce4d953a4d452e11f54b578fa2d7f2f8126246d1120ca24d11845081
Source repository: https://github.com/alchemyplatform/modular-account
Source tag: v2.0.0
Source commit: bd75c9eca7ff5a66aaebc3cf2dab43ddc4622482
Source archive SHA-256: ffafa6f2c08265d1a0eaea423709272d2c32aeeb217f4906d3c3426bac14b899
```

`source-v2.0.0.tar.gz` must contain the complete source tree for this commit.
`source-v2.0.0.tar.gz.sha256` must contain its SHA-256 value.

Alchemy lists this address in its official deployment registry:

```text
https://www.alchemy.com/docs/wallets/smart-contracts/deployed-addresses
```

The source archive contains the upstream `audits` and `deployments` directories.
An auditor must run `npm run verify:alchemy` before release. This command builds
the delegated account from the archived source. It then matches the complete
runtime with the contract on Base Sepolia.

The upstream tag pins four Git submodules. The `submodules/` directory contains
one source archive for each exact commit:

```text
forge-std:               1eea5bae12ae557d589f9f0f0edae2faa47cb262
light-account:           dd4187d1d50751cd2b7a6d6079d87c3114b32f98
openzeppelin-contracts: dbb6104ce834628e473d2173bbc9d47f81a9eec3
webauthn-sol:            619f20ab0f074fef41066ee4ab24849a913263b2
```

`submodules.sha256` authenticates these four archives.

`webauthn-sol` pins four nested submodules. The
`submodules/webauthn-sol/` directory contains source archives at these commits:

```text
FreshCryptoLib:          76f3f135b7b27d2aa519f265b56bfc49a2573ab5
forge-std:               ae570fec082bfe1c1f45b0acca4a2b4f84d345ce
openzeppelin-contracts: 5705e8208bc92cd82c7bcdfeac8dbc7377767d96
solady:                  e7024bee47b1623f436ee491ca9458a6dc8abce9
```

The same checksum file authenticates the nested archives.

### FreshCryptoLib publication sanitisation

The FreshCryptoLib archive is a sanitised derivative of the pinned upstream
commit. It is not a byte-identical copy of the full upstream archive.

The publication transform removes these files and generated test directories:

- `solidity/utils/deploy.sh` contains embedded third-party service credentials.
- `solidity/tests/hardhat/res.dat` contains an upstream test private-key log.
- `solidity/tests/hardhat/node_modules/` contains installed test dependencies and
  upstream machine metadata.
- `solidity/tests/hardhat/cache/` contains generated cache records with upstream
  machine paths.
- `solidity/tests/hardhat/artifacts/` contains generated Hardhat test artifacts.

These excluded paths do not supply source to the delegated account build. The
transform removes 20,103 archive members. It retains 830 regular files and 194
directories, including the required source, tests, and applicable licences.
Every retained payload and file mode is unchanged. Archive ownership and
timestamps are normalised. The gzip timestamp is zero.

[`sanitization.json`](sanitization.json) records the original and sanitised
checksums, exact exclusions, and retained-file comparison results. The
[`sanitisation script`](../../scripts/sanitize-vendor-archive.py) applies and
checks the transformation. It requires a preserved original and a new output
path. The excluded material must stay outside versioned source.

The sanitised source passed the offline account build with Solidity 0.8.26.
Its 23,741-byte runtime matches the reviewed code hash above after applying the
pinned immutable addresses. This check did not contact Base or update historical
deployment evidence.

The original archive remains in the separate private development history and
local quarantine. That history and the original archive are not imported into
this new public repository. The transform does not change those private records.

The upstream lock file pins three source dependencies. The `dependencies/`
directory contains one source archive for each exact commit:

```text
account-abstraction:                 d99245ddb2d7bde4d2132757c4394818f1d11da0
ERC-6900 reference implementation: c9b256cfd963a655179fa3cd9ea3f92c73cbfcdd
solady:                              eb227ea1c5eaa56296e7dd713eb165d5d75891dd
```

`dependencies.sha256` authenticates these three archives. The reproducible
build uses the archived files. It does not download source during the build.

The upstream `foundry.toml` selects Solidity 0.8.26 and EVM Paris. Its account
deployment script requires the `optimized-build` profile. This profile enables
IR, uses 50,000 optimizer runs, and removes bytecode metadata.

GitHub publishes `v2.0.0` as a lightweight tag. The tag points to the pinned
commit above. The archive was made directly from that commit.

GhostClaw also checks the runtime size and code hash before every sponsored write.
