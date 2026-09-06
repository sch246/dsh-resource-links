#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/check-checkout.sh"
cd "$ROOT"
pnpm exec vitest run packages/dsh-resource-links/tests "$@"
