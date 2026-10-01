#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ITERATIONS=20

if [[ "${1:-}" == "--iterations" ]]; then
  if [[ -z "${2:-}" || ! "${2}" =~ ^[1-9][0-9]*$ ]]; then
    echo "Error: --iterations requires a positive whole number." >&2
    exit 1
  fi
  ITERATIONS="$2"
elif [[ $# -ne 0 ]]; then
  echo "Usage: ./scripts/benchmark-local.sh [--iterations NUMBER]" >&2
  exit 1
fi

if ! command -v go >/dev/null 2>&1; then
  echo "Error: Go 1.25.12 or newer is required." >&2
  exit 1
fi

GO_VERSION="$(go env GOVERSION | sed 's/^go//')"
IFS=. read -r GO_MAJOR GO_MINOR GO_PATCH_EXTRA <<< "$GO_VERSION"
GO_PATCH="${GO_PATCH_EXTRA%%[^0-9]*}"
if (( GO_MAJOR < 1 \
  || (GO_MAJOR == 1 && GO_MINOR < 25) \
  || (GO_MAJOR == 1 && GO_MINOR == 25 && GO_PATCH < 12) )); then
  echo "Error: Go 1.25.12 or newer is required." >&2
  exit 1
fi

sha256_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
    return
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
    return
  fi
  echo "Error: install shasum or sha256sum." >&2
  exit 1
}

cpu_name() {
  case "$(uname -s)" in
    Darwin)
      sysctl -n machdep.cpu.brand_string 2>/dev/null || uname -m
      ;;
    Linux)
      if command -v lscpu >/dev/null 2>&1; then
        lscpu | awk -F: '$1 ~ /^Model name/ {sub(/^[[:space:]]+/, "", $2); print $2; exit}'
      else
        uname -m
      fi
      ;;
    *)
      uname -m
      ;;
  esac
}

memory_bytes() {
  case "$(uname -s)" in
    Darwin)
      sysctl -n hw.memsize 2>/dev/null || true
      ;;
    Linux)
      awk '/^MemTotal:/ {print $2 * 1024; exit}' /proc/meminfo 2>/dev/null || true
      ;;
  esac
}

SRS="$REPO_DIR/public-parameters/bn254_g1.dat"
EXPECTED_SHA="3718ffbed583d8a279ccb2545196d5618e3fd97512b65aa051d2ebd0f57fb999"
ACTUAL_SHA="$(sha256_file "$SRS")"
if [[ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]]; then
  echo "Error: the Ignition public parameter digest is incorrect." >&2
  exit 1
fi

WORK_DIR="$REPO_DIR/.benchmark"
RESULT_DIR="$REPO_DIR/benchmark-results"
GHOSTCLAW_GO_CACHE="${TMPDIR:-/tmp}/ghostclaw-go-cache"
mkdir -p "$WORK_DIR/artifacts" "$WORK_DIR/verifiers" "$RESULT_DIR" "$GHOSTCLAW_GO_CACHE"

cd "$REPO_DIR"

echo "GhostClaw local proof benchmark"
echo "Platform: $(uname -s)/$(uname -m)"
echo "Processor: $(cpu_name)"
echo "Go: $(go version)"
echo "Samples per action: $ITERATIONS"
echo

echo "[1/4] Downloading Go modules"
GOCACHE="$GHOSTCLAW_GO_CACHE" go mod download

echo "[2/4] Checking public parameters and creating local setup files"
GOCACHE="$GHOSTCLAW_GO_CACHE" go run ./cmd/ghostclaw-prover setup \
  --ignition-g1 "$SRS" \
  --artifacts "$WORK_DIR/artifacts" \
  --verifiers "$WORK_DIR/verifiers" >/dev/null

echo "[3/4] Running circuit tests"
GOCACHE="$GHOSTCLAW_GO_CACHE" go test ./...

echo "[4/4] Measuring local proof generation"
GOCACHE="$GHOSTCLAW_GO_CACHE" go run ./cmd/ghostclaw-prover benchmark \
  --artifacts "$WORK_DIR/artifacts" \
  --iterations "$ITERATIONS" \
  --out "$RESULT_DIR/latest-local.json"

{
  echo "date=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "platform=$(uname -s)/$(uname -m)"
  echo "processor=$(cpu_name)"
  echo "memoryBytes=$(memory_bytes)"
  echo "go=$(go version)"
} > "$RESULT_DIR/local-environment.txt"

echo
echo "Benchmark complete."
echo "Result: $RESULT_DIR/latest-local.json"
echo "Environment: $RESULT_DIR/local-environment.txt"
