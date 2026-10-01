# GhostClaw 1.5.7

## Scope

This release adds the guided agent welcome.

An interactive `start` opens Claude Code or Codex with a prepared prompt. The agent reads the GhostClaw spending budget. It then shows the public account, network, wallet-ready state, and payment limits.

The agent explains that the address report costs 1 valueless test gUSD. It asks for explicit approval before it calls `ghostclaw_fetch`.

## Privacy

- The welcome contains the public Base account.
- The welcome confirms that private test funds are available.
- The exact private balance stays in the local wallet.
- Private notes, witnesses, and keys stay outside the agent conversation.
- The address-report URL contains only the public Base account.

## Safety

- The prepared prompt accepts only a Base Sepolia account.
- The agent must wait for an explicit yes before payment.
- `--no-launch` keeps the agent client closed.
- CI and non-interactive processes do not launch an agent.
- Version `1.5.7` uses the signed `1.5.4` native prover packages.
