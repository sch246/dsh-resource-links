#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECKOUT="${DSH_CHECKOUT:?set DSH_CHECKOUT to an explicit Harness checkout}"
test -f "$CHECKOUT/package.json"
git -C "$CHECKOUT" rev-parse --is-inside-work-tree >/dev/null
if [ -e "$ROOT/harness" ] && [ ! -L "$ROOT/harness" ]; then
  echo "refusing to replace non-symlink $ROOT/harness" >&2
  exit 1
fi
ln -sfn "$CHECKOUT" "$ROOT/harness"
