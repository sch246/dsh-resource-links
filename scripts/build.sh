#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/check-checkout.sh"
cd "$ROOT"
pnpm exec tsc -p packages/dsh-resource-links/tsconfig.host.json --pretty false
(cd packages/dsh-resource-links && pnpm exec tsdown --config tsdown.host.config.ts)
node scripts/generate-typert-host.mjs
pnpm exec tsc -p packages/dsh-resource-links/tsconfig.client.json --pretty false
(cd packages/dsh-resource-links && pnpm exec tsdown --config tsdown.client.config.ts)
for artifact in index.js client.js typert.host.js typert.remote-client.js; do
  test -f "packages/dsh-resource-links/lib/$artifact"
done
