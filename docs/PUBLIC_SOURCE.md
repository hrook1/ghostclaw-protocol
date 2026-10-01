# Public source provenance

## What this repository contains

`hrook1/ghostclaw-protocol` starts with a cleaned GhostClaw source snapshot and
fresh Git history. The source includes the protocol, client, services, website,
tests, reviewed public proving files, and sanitised dependency source.

The initial snapshot derives from reviewed predecessor commit
`89a5574af513d47efef8918238f70450b32c7e79`. Public-origin metadata, documentation,
publication checks, and unused upstream build output were adjusted for this export.
That predecessor commit is a provenance reference, not an imported Git ancestor.

## What was not copied

- The predecessor's `.git` directory, commits, branches, or tags.
- Old release archives or release assets.
- Wallet backups, operator configuration, environment files, or service credentials.
- Local quarantine, build caches, personal documents, or provider project state.

The predecessor remains private. Its signed history and release evidence were
not rewritten. Do not push its old branches or tags into this repository.

The [publication review](REPOSITORY_REVIEW.md) records exclusions and limitations.
Some historical verification records remain as labelled evidence. Public-export
redactions remove unnecessary hosting and database identifiers. These records do not
attest to this repository's initial commit or a new release.

## Release and runtime identities

The source retains package version `1.5.7`, native runtime pin `1.5.4`, and proving
file release `1.5.0`. Existing npm packages, artifact hashes, signing public keys,
contract addresses, and hosted URLs are unchanged. This publication does not
deploy a service, provision a wallet, or publish a package.

The Go module retains its historical identity:

```text
github.com/hrook1/ghostclaw-confidential-payments
```

Changing that identity would change source imports and can change native binary
output. Local builds resolve these packages from this checkout. The module name
is not an instruction to copy private Git history or use the predecessor as a public source URL.

Repository metadata and future release provenance identify this new repository.
Do not recreate historical signed release tags on the new commit.

## Operations and licensing

Package publication and hosted acceptance workflows require explicit manual
approval and their documented prerequisites. Configure the new repository's
trusted publisher, release environment, signing, and provenance before a future release.
No existing secrets or deployment integrations were copied.

Configure the [merchant secret](MERCHANT_CONFIGURATION.md) before any deployment
of this source. The endpoint returns a generic `503` without valid configuration.

The existing `UNLICENSED` status remains. Public visibility does not grant an
open-source licence. Third-party source retains its own notices and licences.

This is experimental Base Sepolia software for valueless test assets. Public
source and passing tests do not establish independent audit or mainnet readiness.
