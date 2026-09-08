# Test maintenance scope

The user authorized removal of product-behavior tests while retaining necessary external-contract and mechanical-invariant checks. Confirmed intent belongs in STATE, not a parallel assertion suite. The shared meta-intent Agent entry carries this rule.

Removed 6 complete test files; mixed files retain only the applicable grounded checks. Unused runner entries, UI test dependencies and fixtures were removed where no retained consumer uses them. Runtime source and live profile are unchanged.

Retained evidence resources:

- `packages/dsh-user-files/tests/remote.host.spec.ts`: external Remote service transport and typed error contract.
- `packages/dsh-user-files/tests/patch.host.spec.ts`: patch coordinates, hashes, stale/overlap rejection and atomic staging.
- `packages/dsh-user-files/tests/stream.host.spec.ts`: stream byte/text/hash equivalence, approval-before-read and cancellation.
- `packages/dsh-user-files/tests/chunks.host.spec.ts`: chunk ordering, offsets, limits, stale-file and handle cleanup invariants.
- `packages/dsh-user-files/tests/install.spec.ts`: provider compatibility/consumer lifecycle contract.
- `packages/dsh-user-files/tests/text-patch.spec.ts`: exact patch boundary reconstruction and scan budgets.
- `packages/dsh-user-files/tests/delta.host.spec.ts`: baseline/hash/delta bounds, admission and canonical range invariants.
- `packages/dsh-user-files/tests/filesystem.host.spec.ts`: disk encoding, approval ceilings, revision/hash and concurrent-write safety.
- `scripts/host-patch.test.mjs`: idempotent owned patch apply/removal and drift/data-loss safeguards.
- `scripts/removed-link.test.mjs`: exact owned symlink removal safety.

No tests or builds were run for this cleanup. Syntax, manifest/reference consistency and diff checks are static evidence only.
