#!/usr/bin/env bash
# Rebuild the two patched Client owners and the static Web shell.
set -euo pipefail
CHECKOUT="${DSH_CHECKOUT:?set DSH_CHECKOUT explicitly}"
test -f "$CHECKOUT/packages/client/ui-chat/tsconfig.json"
test -f "$CHECKOUT/packages/client/ui-primitives/tsconfig.json"
(
  cd "$CHECKOUT"
  node node_modules/typescript/bin/tsc -b packages/client/ui-primitives/tsconfig.json packages/client/ui-chat/tsconfig.json --pretty false
)
for package in ui-primitives ui-chat; do
  (
    cd "$CHECKOUT/packages/client/$package"
    DSH_BUILD_FACE=client node "$CHECKOUT/node_modules/tsdown/dist/run.mjs" --config tsdown.config.ts
  )
done
(
  cd "$CHECKOUT/apps/web"
  node node_modules/vite/bin/vite.js build
)
