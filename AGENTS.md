# Resource links plugin

This repository owns an out-of-tree DeepSeek Harness plugin for resolving existing paths in displayed messages and routing resource opens. Read `.intent/state/STATE.md` before changing behavior. The live Harness checkout and linked plugin checkouts are not implementation workspaces.

- Keep filesystem metadata and mutations in the file manager; resource links owns candidate recognition, bounded metadata batching and caching, and Chat open policy.
- Host display adapters are an attributable reversible patch, not authority to edit unrelated Harness behavior. Preserve existing Host modifications and ownership receipts.
- Use explicit `DSH_CHECKOUT`, `DSH_HOME`, and `DSH_PROFILE` for builds and profile operations. Setup and uninstall inspect by default and never restart services.
- Record intended behavior in STATE and executed evidence in LOG. Do not claim an accepted realization from tests or a candidate build.
- Use independent Git worktrees for worker implementation; do not modify other plugins without assigned ownership.
