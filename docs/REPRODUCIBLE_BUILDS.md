# Reproducible native builds

## Purpose

Each native npm package contains the gnark prover and its process limiter.

The release workflow builds each package on the matching GitHub runner. It
publishes SHA-256 checksums and a keyless Sigstore bundle.

## Requirements

Use the signed source tag when reproducing a published release. The initial public
snapshot does not include the predecessor's signed tags. It is not a replacement
for those release identities. See [public source provenance](PUBLIC_SOURCE.md).

Install these tools:

```text
Node.js 22.14.0 or later
Go 1.25.12
npm 11.10.0
```

Use a clean checkout. Keep `go.mod` and `go.sum` unchanged.

## Build one package

Run this command on the target system:

```sh
npm ci --ignore-scripts
npm run build:native -- <platform> <architecture>
```

Supported targets are:

```text
darwin arm64
darwin x64
linux arm64
linux x64
win32 x64
```

Build each macOS package on its matching macOS CPU. The limiter uses the macOS `libproc` interface.

The build uses these Go controls:

```text
-buildvcs=false
-mod=readonly
-trimpath
-ldflags=-s -w -buildid=
```

These controls remove local paths, VCS metadata, debug tables, and the Go build identifier.

## Compare the output

The build writes:

```text
packages/prover-<platform>-<architecture>/bin/
packages/prover-<platform>-<architecture>/checksums.json
```

Compare `checksums.json` with the release package. Both binary hashes must match.

Pack the package with:

```sh
mkdir -p release/packages
npm pack ./packages/prover-<platform>-<architecture> \
  --pack-destination release/packages \
  --cache .ghostclaw/npm-cache
```

Verify the Sigstore bundle for the release tarball. The certificate identifies
the signed GitHub Actions workflow. Existing releases came from the private
predecessor and do not gain public registry provenance through this source export.
The existing npm packages and their attestations remain unchanged. Configure and
verify signing, trusted publishing, and public provenance separately for future releases.

## Expected differences

A different Go version can change the binary. A different target operating system or CPU must change it.

The source tag, Go version, target, and build flags must match before a byte comparison is valid.

## Proving files

Native binary reproduction does not reproduce the circuit artifacts.

Run this separate command for those files:

```sh
npm run verify:artifacts
```

The command regenerates every constraint system, proving key, verification key, and Solidity verifier from the pinned source and SRS.

Check the versioned CDN copies with:

```sh
npm run verify:public-artifacts
```

This command compares each committed public file with the same package-pinned
size and SHA-256 hash.
