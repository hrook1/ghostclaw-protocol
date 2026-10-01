#!/usr/bin/env sh
set -eu
export LC_ALL=C
export LANG=C
umask 077

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
source_root="$project_root/third_party/alchemy-modular-account-v2"
work_dir=$(mktemp -d "${TMPDIR:-/tmp}/ghostclaw-alchemy.XXXXXX")

cleanup() {
  rm -rf "$work_dir"
}
trap cleanup EXIT INT TERM

cd "$source_root"
shasum -a 256 -c source-v2.0.0.tar.gz.sha256
shasum -a 256 -c submodules.sha256
shasum -a 256 -c dependencies.sha256

tar -xzf source-v2.0.0.tar.gz -C "$work_dir"

extract_archive() {
  archive=$1
  destination=$2
  mkdir -p "$destination"
  tar -xzf "$archive" --strip-components=1 -C "$destination"
}

extract_archive "$source_root/submodules/forge-std-1eea5bae12ae557d589f9f0f0edae2faa47cb262.tar.gz" "$work_dir/lib/forge-std"
extract_archive "$source_root/submodules/light-account-dd4187d1d50751cd2b7a6d6079d87c3114b32f98.tar.gz" "$work_dir/lib/light-account"
extract_archive "$source_root/submodules/openzeppelin-contracts-dbb6104ce834628e473d2173bbc9d47f81a9eec3.tar.gz" "$work_dir/lib/openzeppelin-contracts"
extract_archive "$source_root/submodules/webauthn-sol-619f20ab0f074fef41066ee4ab24849a913263b2.tar.gz" "$work_dir/lib/webauthn-sol"
extract_archive "$source_root/submodules/webauthn-sol/FreshCryptoLib-76f3f135b7b27d2aa519f265b56bfc49a2573ab5.tar.gz" "$work_dir/lib/webauthn-sol/lib/FreshCryptoLib"
extract_archive "$source_root/submodules/webauthn-sol/forge-std-ae570fec082bfe1c1f45b0acca4a2b4f84d345ce.tar.gz" "$work_dir/lib/webauthn-sol/lib/forge-std"
extract_archive "$source_root/submodules/webauthn-sol/openzeppelin-contracts-5705e8208bc92cd82c7bcdfeac8dbc7377767d96.tar.gz" "$work_dir/lib/webauthn-sol/lib/openzeppelin-contracts"
extract_archive "$source_root/submodules/webauthn-sol/solady-e7024bee47b1623f436ee491ca9458a6dc8abce9.tar.gz" "$work_dir/lib/webauthn-sol/lib/solady"
extract_archive "$source_root/dependencies/account-abstraction-d99245ddb2d7bde4d2132757c4394818f1d11da0.tar.gz" "$work_dir/node_modules/account-abstraction"
extract_archive "$source_root/dependencies/reference-implementation-c9b256cfd963a655179fa3cd9ea3f92c73cbfcdd.tar.gz" "$work_dir/node_modules/@erc6900/reference-implementation"
extract_archive "$source_root/dependencies/solady-eb227ea1c5eaa56296e7dd713eb165d5d75891dd.tar.gz" "$work_dir/node_modules/solady"

cd "$work_dir"
FOUNDRY_PROFILE=optimized-build forge build -j 1 src/account/SemiModularAccount7702.sol

node "$project_root/scripts/verify-alchemy-runtime.mjs" \
  --artifact "$work_dir/out-optimized/SemiModularAccount7702.sol/SemiModularAccount7702.json" \
  --rpc "${BASE_SEPOLIA_RUNTIME_RPC_URL:-https://sepolia.base.org}" \
  --out "$project_root/audit-materials/alchemy/delegation-runtime-reproduction.json"

printf '%s\n' "The archived Alchemy source reproduces the Base Sepolia runtime exactly."
