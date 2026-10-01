#!/usr/bin/env sh
set -eu

if ! command -v node >/dev/null 2>&1; then
  echo "Install Node.js 22 or later." >&2
  exit 1
fi

node_major=$(node -p 'process.versions.node.split(".")[0]')
if [ "$node_major" -lt 22 ]; then
  echo "Install Node.js 22 or later." >&2
  exit 1
fi

npm ci
exec node scripts/ghostclaw.mjs init "$@"
