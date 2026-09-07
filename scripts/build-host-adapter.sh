#!/usr/bin/env bash
# Rebuild the patched Client owners, their inspect catalog, and the static Web shell.
set -euo pipefail
CHECKOUT="${DSH_CHECKOUT:?set DSH_CHECKOUT explicitly}"
test -f "$CHECKOUT/packages/client/ui-chat/tsconfig.json"
test -f "$CHECKOUT/packages/client/ui-primitives/tsconfig.json"
(
  cd "$CHECKOUT"
  node --import tsx/esm scripts/gen-client-catalog.ts
  node node_modules/typescript/bin/tsc -b packages/client/ui-primitives/tsconfig.json packages/client/ui-chat/tsconfig.json packages/client/ui-conversation/tsconfig.json packages/client/ui-attachment/tsconfig.json packages/extensions/cordis-client-runner/tsconfig.json --pretty false
)
for package in client/ui-primitives client/ui-conversation client/ui-chat client/ui-attachment extensions/cordis-client-runner; do
  (
    cd "$CHECKOUT/packages/$package"
    DSH_BUILD_FACE=client node "$CHECKOUT/node_modules/tsdown/dist/run.mjs" --config tsdown.config.ts
  )
done
(
  cd "$CHECKOUT/apps/web"
  node node_modules/vite/bin/vite.js build
)
