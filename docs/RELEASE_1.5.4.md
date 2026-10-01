# GhostClaw 1.5.4

## User changes

- Add `ghostclaw start` for one-command Base Sepolia playtest setup.
- Require one human approval before guided setup changes the machine.
- Show clear setup progress outside the machine-readable result.
- Connect detected Claude and Codex clients after a configuration backup.
- Claim and privately deposit valueless test gUSD during guided setup.
- Keep existing private test funds when guided setup runs again.
- Normalize safe npm group-write permissions on single-user Linux systems.
- Report a locked operating-system credential store before a payment.

## Safety behavior

GhostClaw removes group write permission only when the file belongs to the
current Linux user and the primary group contains that user only. It verifies
the native package hash after the permission change.

GhostClaw rejects a shared group, world write permission, a symbolic link, or a
file owned by another user.

## Release checks

Run `npm run test:full`. Then run both hosted acceptance commands in
`docs/TESTING.md` against the production Base Sepolia service.
