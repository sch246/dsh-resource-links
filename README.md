# User files and optional Links for DeepSeek Harness

This repository retains the Resource Links history and distributes `@dsh-external/dsh-user-files`: authenticated Session-relative file access plus optional Markdown inline-code links. Viewer, manager and sidebar are independent consumers. The [package reference](packages/dsh-user-files/README.md) owns API/configuration behavior; [STATE](.intent/state/STATE.md) guides installation and adaptation.

```sh
pnpm install
DSH_CHECKOUT=/absolute/candidate/harness pnpm run build
DSH_CHECKOUT=/absolute/candidate/harness pnpm run typecheck
DSH_CHECKOUT=/absolute/candidate/harness pnpm test
```

Build uses repository-local TypeScript 5.9.3, tsdown 0.22.14 and Vitest 4.1.8. Vite 7.3.6 is pinned for standard decorator transformation in source tests. `DSH_CHECKOUT` selects Host declarations and the out-of-tree Typert generator. Build the selected Host first. The package can be packed from `packages/dsh-user-files` without any manager or viewer checkout.

Setup and uninstall require explicit `DSH_CHECKOUT`, `DSH_HOME` and `DSH_PROFILE`; both inspect by default. `setup --install` verifies or applies the attributable Host adapter, builds artifacts, then installs a missing provider through `dsh plugin add`. Compatible existing providers are reused. `uninstall --remove` refuses while any remaining declared consumer requires user-files, removes the provider and its owned adapter, and rebuilds affected catalogs. Neither entry restarts services.

Existing Resource Links installations require the coordinated migration in STATE: preserve complete configuration, transfer old Host receipts using exact source evidence, remove the old Bundle and install one user-files provider. Setup refuses automatic adoption of an old receipt or an old resource-links Bundle. Historical patch evidence is frozen at [patches/history/resource-links.patch](patches/history/resource-links.patch). Current owned support combines the common opener and Markdown display API; shared Typert support remains separately owned.

The Host adapter also confines attachment file drops and their overlay to the conversation area. Right-sidebar groups and manager uploads remain independent consumers with their own drop handling; no additional feature dependency is required for Chat attachments. The adapter build includes `ui-conversation` and `ui-attachment`. See [drop ownership](docs/agent-notes/scoped-file-drops.md) and STATE for adaptation and removal.
