# GhostClaw 1.5.6

## Scope

This release completes the guided `start` command.

An interactive `start` now opens the connected agent client after wallet setup and test funding. The command prefers Claude Code when more than one client is connected.

Use `--no-launch` to finish setup without opening an agent client. A non-interactive process never opens a client.

## Security properties

- GhostClaw opens only Claude Code, Codex, or Claude Desktop.
- The launch command does not use a shell.
- CI and piped commands do not open an application.
- `GHOSTCLAW_NO_LAUNCH=1` disables the launch.
- Wallet setup and private test funding finish before the client opens.
- Version `1.5.6` uses the signed `1.5.4` native prover packages.

## Release checks

Run the JavaScript tests, package checks, Go tests, contract tests, dependency checks, and proving-file checks before publication.

Publish the root `ghostclaw` package. The native prover source did not change.
