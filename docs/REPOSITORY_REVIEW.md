# Repository publication review

## Scope

This repository publishes a reviewed source snapshot with a new Git history.
It does not import the private predecessor's commits, tags, release archives,
operator files, or hosted configuration. This review is not an independent
protocol audit or a new package release. See [public source provenance](PUBLIC_SOURCE.md).

The active product is the `ghostclaw` npm package in this repository. The older
workspace contains experimental Noir, FFLONK, Miden, desktop, and landing-page work.
Those directories are not dependencies of this package.

The `site/` import preserves the existing website source from
`independent/editorial-signal/`. It excludes environment files, provider project
state, personal material, and discarded designs. The existing unpublished
`docs/PUBLIC_DOCUMENTATION.md` is included as a product reference.

## Sensitive material excluded from this snapshot

- The demo merchant's encrypted wallet deployment moves to operator-held configuration.
  Follow [the configuration migration](MERCHANT_CONFIGURATION.md) before deployment.
- A vendored FreshCryptoLib deployment script contained five plausible upstream
  service credentials. Their validity was not tested. The sanitised archive omits
  that script and a test log. It also excludes unused upstream build output and
  dependency caches. Its provenance records the changed archive checksum and exclusions.
- The old `downloads/` release archive is no longer distributed in the current tree.
  It contains a duplicate of the old vendor material. Signed archives and their
  attestations were preserved together in local, ignored quarantine.
- The release signer uses the same public key with a non-personal principal.
  A historical verification transcript has an explicitly redacted identity field.

The quarantine is `.operator/publication-quarantine/` in the original local
checkout. It was not copied into this repository, the npm package, or a hosted deployment.

## History remains separate

The private predecessor still contains upstream credentials, personal commit
identities, encrypted wallet state, and old machine-specific paths in earlier
Git objects. Those objects are not ancestors of this repository's initial commit.
No predecessor tags, branches, releases, or Git object directories were imported.

Keep the predecessor private. Before disclosing its history, coordinate cleanup
and credential revocation with the relevant owners. Rewriting that history would
change commit identifiers and invalidate affected signed tags. This publication
does not rewrite that history. Never upload the quarantined originals here.

No project-owned plaintext API key or wallet secret was identified in the reviewed
source. Automated matching cannot prove that a repository contains no secrets.

## Ongoing checks

The repository guard checks indexed file paths, personal data patterns, and local
documentation links. It reads the Git index, so a clean working file cannot hide
an unsafe staged file.

Gitleaks checks a clean export of the proposed tree, including nested archives.
Pull requests and updates to `main` also scan newly introduced history. Initial
publication and manual checks scan the complete new history. Exceptions are
restricted to reviewed public contract values and test fixtures. Actual credential
findings are not allowlisted.

Public proving keys, verification keys, deployment addresses, and transaction
hashes are intentional protocol material. They are not private wallet keys.

## Dependency maintenance

The review updated four compatible transitive JavaScript dependencies:

| Package | Previous | Updated |
| --- | --- | --- |
| `fast-uri` | `3.1.5` | `3.1.8` |
| `hono` | `4.13.0` | `4.13.12` |
| `ip-address` | `10.4.0` | `10.7.2` |
| `qs` | `6.15.3` | `6.16.0` |

Direct dependency declarations and cryptographic dependency versions are unchanged.
The production npm audit passed after these changes. The Go vulnerability check
found no called vulnerable symbols. It reported advisories in dependencies that
the current analysis did not find reachable. Neither result establishes a complete
security audit. Rerun the checks because vulnerability databases change.

See [the security policy](../SECURITY.md) for reporting and
[the contributor guide](../CONTRIBUTING.md) for verification commands.
