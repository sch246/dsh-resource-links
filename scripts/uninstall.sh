#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECKOUT="${DSH_CHECKOUT:?set DSH_CHECKOUT explicitly}"
PROFILE_HOME="${DSH_HOME:?set DSH_HOME explicitly}"
PROFILE="${DSH_PROFILE:?set DSH_PROFILE explicitly}"
case "${1:---check}" in
  --check)
    node "$ROOT/scripts/host-patch.mjs" --check
    node "$ROOT/scripts/profile-state.mjs" --check
    echo 'Inspection only; no profile or service changed.'
    ;;
  --remove)
    node "$ROOT/scripts/host-patch.mjs" --check
    node "$ROOT/scripts/profile-state.mjs" --remove-dependency
    node "$ROOT/scripts/profile-state.mjs" --finish-removal
    node "$ROOT/scripts/profile-state.mjs" --removed
    node "$ROOT/scripts/host-patch.mjs" --remove
    bash "$ROOT/scripts/build-host-adapter.sh"
    echo 'Removed from disk and rebuilt the Host adapter artifacts; no service restart performed.'
    ;;
  *) echo 'usage: uninstall.sh [--check|--remove]' >&2; exit 2 ;;
esac
