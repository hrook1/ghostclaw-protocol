#!/usr/bin/env sh
set -eu
umask 077

project_root=$(git rev-parse --show-toplevel)
scanner=${GITLEAKS_BIN:-gitleaks}
if ! command -v "$scanner" >/dev/null 2>&1; then
  printf '%s\n' 'Install Gitleaks 8.30.1 or set GITLEAKS_BIN to its executable.' >&2
  exit 1
fi

# Export the index, not local operator state or an unstaged replacement file.
scan_dir=$(mktemp -d "${TMPDIR:-/tmp}/ghostclaw-secret-check.XXXXXX")
trap 'rm -rf "$scan_dir"' EXIT HUP INT TERM
mkdir -p "$scan_dir/tree"
cd "$project_root"
git checkout-index --all --prefix="$scan_dir/tree/"
"$scanner" dir "$scan_dir/tree" \
  --config="$scan_dir/tree/.gitleaks.toml" \
  --redact=100 --no-banner --no-color --ignore-gitleaks-allow \
  --max-archive-depth=4 --max-decode-depth=2
