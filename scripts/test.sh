#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/check-checkout.sh"
cd "$ROOT"
node "$ROOT/node_modules/vitest/vitest.mjs" run packages/dsh-user-files/tests "$@"
