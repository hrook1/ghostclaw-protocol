#!/bin/sh
set -eu

exec node scripts/build-native-package.mjs "$@"
