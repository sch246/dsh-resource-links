#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/check-checkout.sh"
cd "$ROOT"
pnpm exec tsc -p packages/dsh-resource-links/tsconfig.host.json --pretty false --noEmit
node scripts/generate-typert-host.mjs
pnpm exec tsc -p packages/dsh-resource-links/tsconfig.client.json --pretty false --noEmit
