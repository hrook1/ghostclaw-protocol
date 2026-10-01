#!/usr/bin/env sh
set -eu
export LC_ALL=C
export LANG=C

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
version=$(tr -d '[:space:]' < "$project_root/VERSION")
release_tag=${GHOSTCLAW_RELEASE_TAG:-"v$version"}
output_dir=${1:-"$project_root/.handoff"}
archive_name="ghostclaw-confidential-payments-${version}.tar.gz"
archive_path="$output_dir/$archive_name"
temporary_dir=$(mktemp -d)
package_dir="$temporary_dir/ghostclaw-confidential-payments-${version}"
unsigned_test_mode=${GHOSTCLAW_RELEASE_TEST_MODE:-0}

cleanup() {
  rm -rf "$temporary_dir"
}
trap cleanup EXIT INT TERM

cd "$project_root"
if [ -n "$(git status --porcelain --untracked-files=all)" ]; then
  echo "The release worktree has tracked or untracked changes."
  exit 1
fi

tag_commit=$(git rev-parse "$release_tag^{commit}")
head_commit=$(git rev-parse HEAD)
if [ "$tag_commit" != "$head_commit" ]; then
  echo "The release tag does not identify the current commit."
  exit 1
fi
if [ "$unsigned_test_mode" != "1" ]; then
  git verify-tag "$release_tag" >/dev/null 2>&1 || {
    echo "The production release tag must have a valid signature."
    exit 1
  }
fi

mkdir -p "$output_dir" "$package_dir"
git archive --format=tar --prefix="ghostclaw-confidential-payments-${version}/" "$release_tag" \
  > "$temporary_dir/source.tar"
tar -C "$temporary_dir" -xf "$temporary_dir/source.tar"
gzip -n -9 < "$temporary_dir/source.tar" > "$archive_path"

node "$project_root/scripts/generate-release-metadata.mjs" \
  "$package_dir" \
  "$archive_path" \
  "$release_tag" \
  "$tag_commit" \
  "$output_dir"

checksum=$(shasum -a 256 "$archive_path" | awk '{print $1}')
printf '%s  %s\n' "$checksum" "$archive_name" > "$archive_path.sha256"

metadata_index="$output_dir/$archive_name.release.sha256"
public_key_source="$project_root/release/ghostclaw-release-cosign.pub"
public_key_name="ghostclaw-release-cosign.pub"
public_key_path="$output_dir/$public_key_name"
test -f "$public_key_source" || {
  echo "The release Cosign public key is missing."
  exit 1
}
cp "$public_key_source" "$public_key_path"
(
  cd "$output_dir"
  shasum -a 256 \
    "$archive_name" \
    "$archive_name.files.sha256" \
    "$archive_name.sbom.cdx.json" \
    "$archive_name.intoto.jsonl" \
    "$public_key_name"
) > "$metadata_index"

if [ "$unsigned_test_mode" != "1" ]; then
  signing_key=${GHOSTCLAW_RELEASE_COSIGN_KEY:-}
  if [ -z "$signing_key" ] || ! command -v cosign >/dev/null 2>&1; then
    echo "Cosign and GHOSTCLAW_RELEASE_COSIGN_KEY are required for a production release."
    exit 1
  fi
  cosign sign-blob --yes --use-signing-config=false --key "$signing_key" \
    --bundle "$metadata_index.sigstore.json" \
    "$metadata_index"
fi

printf '%s\n' "$archive_path"
printf '%s\n' "$checksum"
