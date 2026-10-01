#!/usr/bin/env sh
set -eu
export LC_ALL=C
export LANG=C

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
work_dir=$(mktemp -d "${TMPDIR:-/tmp}/ghostclaw-artifacts.XXXXXX")

cleanup() {
  rm -rf "$work_dir"
}
trap cleanup EXIT INT TERM

cd "$project_root"
go run ./cmd/ghostclaw-prover setup \
  --ignition-g1 public-parameters/bn254_g1.dat \
  --artifacts "$work_dir/artifacts" \
  --verifiers "$work_dir/verifiers"

# gnark emits deterministic verifier values with non-canonical whitespace.
# Format both release and reproduced files before the byte comparison.
forge fmt "$work_dir"/verifiers/*.sol

node scripts/stage-artifacts.mjs "$work_dir/reference" >/dev/null
for artifact in \
  manifest.json \
  identity.ccs identity.pk identity.vk \
  deposit.ccs deposit.pk deposit.vk \
  spend.ccs spend.pk spend.vk \
  withdraw.ccs withdraw.pk withdraw.vk
do
  diff -q "$work_dir/reference/.verification/$artifact" "$work_dir/artifacts/$artifact"
done
for verifier in \
  GhostClawGnarkIdentityVerifierV2.sol \
  GhostClawGnarkDepositVerifierV2.sol \
  GhostClawGnarkSpendVerifierV2.sol \
  GhostClawGnarkWithdrawVerifierV2.sol
do
  diff -q "contracts/generated/$verifier" "$work_dir/verifiers/$verifier"
done

printf '%s\n' "All proof artifacts and generated verifiers reproduce exactly."
