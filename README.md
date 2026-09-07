# User files and optional Links for DeepSeek Harness

## Workspace operations

The root is a development workspace; installable packages live under `packages/`. Run these root entries with prepared repository-local dependencies. `DSH_CHECKOUT` selects compatible Host source/declarations; profile operations also require explicit `DSH_HOME` and `DSH_PROFILE`.

| Root entry | Direct command from this repository | Effect |
| --- | --- | --- |
| `build` | `bash scripts/build.sh` | Build owned package artifacts. |
| `typecheck` | `bash scripts/typecheck.sh` | Check owned Host and Client programs. |
| `setup` | `bash scripts/setup.sh` | Inspect by default; append `--install` for installation. |
| `inspect` | `bash scripts/setup.sh --check` | Inspect only. |
| `remove` | `bash scripts/uninstall.sh` | Inspect by default; append `--remove` for removal. |

Build, typecheck and existing tests call installed Node tools directly; they never install dependencies. Tool versions are TypeScript 5.9.3, tsdown 0.22.14 and Vitest 4.1.8, with pnpm 10.17.1 declared for explicit dependency preparation. Use independent dependency directories when reusing existing package contents. Installation and removal retain the existing `dsh plugin` transactions and never restart services. The `uninstall` alias, where present, has the same inspection default as `remove`.

Each repository and package keeps its own version: compatibility means satisfying declared API ranges, not equal version numbers. Optional cooperation does not make another feature a required dependency. Root and distributed package licenses are MIT, with their copyright notices retained.

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

File-drop routing and its upstream adaptation belong to the independent `@dsh-external/dsh-file-drop` plugin and its own STATE. Neither package requires the other. This repository's Host patch covers only the common opener and Markdown display API; [ownership guidance](docs/agent-notes/scoped-file-drops.md) describes transfer from installations that combined them.
