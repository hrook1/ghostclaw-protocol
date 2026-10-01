# Local wallet

## Key domains

The wallet keeps three independent secret domains.

| Domain | Purpose |
|---|---|
| Base transaction key | Signs public Base calls and EIP-7702 authorization. |
| GhostClaw spend key | Controls private notes and identity proofs. |
| Note encryption key | Decrypts received merchant notes. |

The public Base address identifies the payer or merchant. The public owner field
identifies the private note owner. The X25519 public key supports note delivery.

## Files

The wallet uses `~/.ghostclaw/` by default. `GHOSTCLAW_HOME` can select another
absolute directory before wallet creation.

```text
~/.ghostclaw/
  wallet.enc.json
  transaction-key.enc.json
  spend-key.enc.json
  note-key.enc.json
  relay.json
  agent.enc.json
  key-storage.json
  wallet.lock
  outbox/
  backups/
  artifacts/v2/1.5.0/
  cache/
```

The repository ignores this directory. Release tools exclude it.

## Encryption

Each key domain uses a separate 256-bit encryption key. The operating-system
credential store holds these keys. The file data uses AES-256-GCM.

A passphrase file is a supported alternative for SSH hosts and containers.
Use `npx ghostclaw init --passphrase-file <absolute-path>`. The file must use
mode `0600` and contain 12 through 1,024 bytes.

An automated agent can supply `GHOSTCLAW_STATE_KEY` as 64 hexadecimal
characters. HKDF-SHA-256 derives a separate key for each domain. The agent must
keep the root key in a protected secret store.

Wallet directories use mode `0700`. Wallet files use mode `0600`. The runtime
rejects symbolic links, another file owner, and broad permissions.

## Transaction signer

The default setup creates a local secp256k1 Base key. The key stays in the
encrypted transaction domain.

The transaction signer interface can use an external hardware signer. The
external signer must support personal message signatures and EIP-7702
authorization signatures.

The adapter checks the complete sponsored operation before it asks for either
signature.

## Spend key

The spend key creates the owner field and note nullifiers. A user can change the
public Base account while the owner field stays constant.

Loss of the spend key causes loss of note control. Account rotation cannot
replace a lost spend key.

## Note key

The wallet generates an X25519 key pair. A merchant card publishes the DER
encoded public key.

The payer creates an ephemeral X25519 key for each payment note. HKDF-SHA-256
derives an AES-256-GCM key. The plaintext uses a fixed 2,048-byte envelope to
reduce size leakage.

The envelope binds the merchant address and payment intent as authenticated
data. A changed value causes decryption failure.

## State lock and interrupted calls

One exclusive lock protects wallet changes. The lock includes the process ID
and time. The runtime can recover a stale lock after it confirms that the old
process is absent.

Before a state-changing Base call, the wallet records a pending action. After
confirmation, it checks the public commitment or nullifier and updates local
state.

Run this command after an interrupted action:

```sh
ghostclaw recover
```

The command reads Base state. It completes a landed action. It keeps an unknown
action pending.

## Note selection

The wallet selects the smallest available note that can fund the action. A
payment needs a larger note because it must create nonzero change. A withdrawal
can spend the complete note.

The wallet rebuilds the public depth-20 tree from pool events. It first requests
a public event snapshot from the GhostClaw relay. The request does not contain
an account, private note, balance, or payment amount.

The wallet does not trust the snapshot. It adds later Base events. It then
rebuilds the tree and checks the result against the pool state at the same Base
block. A changed or incomplete snapshot cannot create a valid root.

If the snapshot is unavailable, the wallet reads Base directly. Each event
query reads at most 2,000 inclusive blocks. The wallet slows these queries and
automatically retries a Base rate limit.

`GHOSTCLAW_NOTE_TREE_URL` can select another HTTPS snapshot service. A local
test service can use HTTP on a loopback address.

## Backup

Create a backup:

```sh
ghostclaw backup \
  --file ~/.ghostclaw/backups/wallet.json \
  --input -
```

Write the passphrase to standard input. Use a long unique passphrase.

Verify the backup before storage:

```sh
ghostclaw verify-backup \
  --file ~/.ghostclaw/backups/wallet.json \
  --input -
```

Restore a backup into an empty wallet directory:

```sh
ghostclaw restore --file wallet.json --input -
```

The backup uses scrypt and AES-256-GCM. Verification checks the complete
encrypted payload and key-domain consistency.

## Account rotation

Run:

```sh
ghostclaw rotate-account
```

The runtime creates a new Base transaction key. The old spend key proves the
rotation action. The new Base key signs a consent message. The pool moves the
owner to the new account in one transaction.

## Delayed account recovery

Run:

```sh
ghostclaw request-account-recovery
```

The spend key and new Base key authorize the request. The contract starts a
seven-day delay.

The current account can cancel the request:

```sh
ghostclaw cancel-account-recovery
```

After the delay, finalize it:

```sh
ghostclaw finalize-account-recovery
```

The recovery process protects a user who lost the current Base transaction key
but still has the spend key and wallet backup.

## Emergency EIP-7702 exit

Run:

```sh
ghostclaw revoke
```

The adapter checks that the account delegates to the pinned Alchemy runtime. It
then requests a zero-address EIP-7702 authorization. The command checks that the
account code is empty after confirmation.

## Local security limits

The wallet cannot protect secrets from a compromised user account or kernel.
Malware with credential-store access can steal wallet material.

The hosted relay cannot read wallet keys or note plaintext. It can observe the
public account, call type, call time, proof bytes, commitments, and network
metadata.
