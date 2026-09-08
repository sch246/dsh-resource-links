<!-- meta-intent:entry:start -->
## Intent-package entry

Maintain an executable installation and maintenance map as user understanding, upstream software and environments change. The first map can be incomplete; use user feedback and checked reality to improve it, rather than making accumulated implementation debt the permanent design.

- Start with [this package's STATE](.intent/state/STATE.md) and the user's request. STATE tells an unfamiliar Agent which effects to provide, why they matter, where to find resources, and how to install, adapt, verify and remove them under applicable conditions. Keep every supported capability reachable from that map.
- Before writing, distinguish the information's role. STATE owns intended effects and reusable operational guidance. LOG owns selected actual decisions, observations and their reasons; historical implementation gaps, debt inventories and task progress belong there or in a disposable work record. Keep conditions and adaptation steps needed to act in STATE, without turning it into a status table. LOCK retains an exact purpose-bound realization, not permanent requirements. Do not turn this distinction into a mandatory document transaction for each repair.
- Inspect the target and recover relevant existing decisions before inferring new requirements. Code, tests and past installations are evidence about implementations; they do not decide user intent. Optional cooperation does not establish a required dependency. Change STATE when feedback clarifies an effect or experience improves the executable route, not merely because current code differs.
- Maintain confirmed intent in STATE, not a parallel product-behavior test suite. Do not routinely add tests to obtain confidence in an inferred interpretation. Retain useful externally grounded contract and mechanical-invariant checks; remove superseded UI/behavior expectations and unused test scaffolding within the authorized scope. A test is evidence, not a veto over clarified intent, and retained tests need not run for unrelated changes.
- Act within the user's existing authority. Read selected sources when why, scope or attribution matters; do not replay every LOG. Choose checks that resolve a real uncertainty at reasonable cost, and distinguish observed results from unperformed checks.
- This entry routes attention; it does not replace STATE or the selected protocol. Follow the package's state record for protocol/binding changes. See [meta-intent's map](../meta-intent/state/STATE.md) when maintaining this guidance or when the roles themselves are unclear.
<!-- meta-intent:entry:end -->

# User files plugin

This repository owns shared authenticated user-file access and optional Links in an out-of-tree DeepSeek Harness package. Read `.intent/state/STATE.md` before changing behavior. The live Harness checkout and linked plugin checkouts are not implementation workspaces.

- Follow STATE as the executable installation and maintenance map: Links is optional within shared file access and requires no sidebar, viewer or manager UI. Record existing coupling, implementation progress and execution evidence in LOG; refine the map from user feedback and observed facts.
- Host display adapters are an attributable reversible patch, not authority to edit unrelated Harness behavior. Preserve existing Host modifications and ownership receipts.
- Use explicit `DSH_CHECKOUT`, `DSH_HOME`, and `DSH_PROFILE` for builds and profile operations. Setup and uninstall inspect by default and never restart services.
- Record intended behavior in STATE and executed evidence in LOG. Do not claim an accepted realization from tests or a candidate build.
- Use independent Git worktrees for worker implementation; do not modify other plugins without assigned ownership.
