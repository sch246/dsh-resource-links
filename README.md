# Resource links for DeepSeek Harness

This independent plugin discovers existing filesystem paths in Markdown inline code in displayed Chat messages and routes explicit resource opens. The local Web deployment is recorded in [the activation log](.intent/logs/2026-09-05-managed-activation.md); that record does not establish user visual acceptance or portability to another Host. The current implementation requires compatible Host, file-manager and resource-workbench APIs; their package version numbers need not match. [The dependency map](.intent/state/STATE.md#intended-dependencies-and-pending-migration) records the pending move to an optional shared-file-provider feature.

The [package reference](packages/dsh-resource-links/README.md) owns recognition, configuration and routing behavior. [STATE](.intent/state/STATE.md) records intended behavior; [LOG](.intent/LOG.md) records executed evidence. The [ownership note](docs/agent-notes/resource-links-ownership.md) explains the direct transfer of Chat routing from the manager.

Build against an explicitly selected Harness after its Host and Client declarations, the file manager and the resource workbench are built:

```sh
pnpm install --ignore-scripts
DSH_CHECKOUT=/absolute/candidate/harness pnpm run build
DSH_CHECKOUT=/absolute/candidate/harness pnpm run typecheck
DSH_CHECKOUT=/absolute/candidate/harness pnpm test
```

`DSH_CHECKOUT`, `DSH_HOME` and `DSH_PROFILE` are required for profile operations. Both setup and uninstall inspect by default. Setup `--install` applies the owned incremental Host patch, rebuilds its Host/browser artifacts and this plugin, and installs its Bundle with `dsh plugin add`; uninstall `--remove` verifies patch ownership, atomically removes the Bundle, reverses its patch and rebuilds the changed Host/browser artifacts. Neither command restarts a service. A failure stops at that step; earlier source/artifact changes remain visible for recovery. Use a private Home containing the target profile's complete plugin set for the first installation probe; package presence alone does not prove the browser can boot.

```sh
DSH_CHECKOUT=/absolute/candidate/harness DSH_HOME=/absolute/private-home DSH_PROFILE=web pnpm run setup
DSH_CHECKOUT=/absolute/candidate/harness DSH_HOME=/absolute/private-home DSH_PROFILE=web pnpm run setup --install
DSH_CHECKOUT=/absolute/candidate/harness DSH_HOME=/absolute/private-home DSH_PROFILE=web pnpm run uninstall --check
DSH_CHECKOUT=/absolute/candidate/harness DSH_HOME=/absolute/private-home DSH_PROFILE=web pnpm run uninstall --remove
```

The profile must already compose the file manager, generic resource workbench and right sidebar. Those plugins own their respective installation transactions. Do not hand-edit profile dependency or Bundle JSON. Setup requires the adapter patch maintained in this repository; it does not adopt historical patches owned by other plugins. The patch expects the earlier Chat waterfall baseline; see [Host baseline and receipt limits](.intent/state/STATE.md#host-baseline-and-receipt-limits) before selecting a new Host or reversing an integrated installation.

Uninstall can resume after the dependency transaction has completed. It verifies absence from the manifest, lockfile and composed profile, then removes a leftover package symlink only when it resolves to this exact checkout. A different target or a real directory is retained and reported as a conflict. Host reversal and Client catalog regeneration follow verified package removal.
