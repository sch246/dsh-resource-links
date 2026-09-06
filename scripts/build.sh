#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/check-checkout.sh"
cd "$ROOT"
pnpm exec tsc -p packages/dsh-user-files/tsconfig.host.json --pretty false
(cd packages/dsh-user-files && pnpm exec tsdown --config tsdown.host.config.ts)
node scripts/generate-typert-host.mjs
pnpm exec tsc -p packages/dsh-user-files/tsconfig.client.json --pretty false
(cd packages/dsh-user-files && pnpm exec tsdown --config tsdown.client.config.ts)
for artifact in index.js client.js typert.host.js typert.remote-client.js; do
  test -f "packages/dsh-user-files/lib/$artifact"
done
