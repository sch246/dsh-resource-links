#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECKOUT="${DSH_CHECKOUT:?set DSH_CHECKOUT explicitly}"
PROFILE_HOME="${DSH_HOME:?set DSH_HOME explicitly}"
PROFILE="${DSH_PROFILE:?set DSH_PROFILE explicitly}"
run_plugin() { (cd "$CHECKOUT" && DSH_HOME="$PROFILE_HOME" node --import tsx/esm apps/cli/src/bin.ts plugin --profile "$PROFILE" "$@"); }
verify_install() {
  node "$ROOT/scripts/profile-state.mjs" --verify
  node "$ROOT/scripts/host-patch.mjs" --check
}
case "${1:---check}" in
  --check)
    node "$ROOT/scripts/host-patch.mjs" --check
    node "$ROOT/scripts/profile-state.mjs" --check
    echo 'Inspection only; no profile or service changed.'
    ;;
  --install)
    node "$ROOT/scripts/host-patch.mjs" --apply
    bash "$ROOT/scripts/build-host-adapter.sh"
    bash "$ROOT/scripts/build.sh"
    PROVIDER_PLAN="$(node "$ROOT/scripts/profile-state.mjs" --plan-install)"
    if [ -n "$PROVIDER_PLAN" ]; then run_plugin add "$PROVIDER_PLAN"; fi
    verify_install
    echo 'Installed on disk; no service restart performed.'
    ;;
  *) echo 'usage: setup.sh [--check|--install]' >&2; exit 2 ;;
esac
