#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/check-checkout.sh"
cd "$ROOT"
node "$ROOT/node_modules/typescript/bin/tsc" -p packages/dsh-user-files/tsconfig.host.json --pretty false --noEmit
node scripts/generate-typert-host.mjs
node "$ROOT/node_modules/typescript/bin/tsc" -p packages/dsh-user-files/tsconfig.client.json --pretty false --noEmit
