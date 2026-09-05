# Resource links for DeepSeek Harness

This independent plugin discovers existing filesystem paths in displayed Chat messages and routes explicit resource opens. It is an uninstalled candidate; test and build evidence does not establish accepted deployment. The Host adapter patch and plugin must be deployed together with the matching file-manager and resource-workbench versions.

The [package reference](packages/dsh-resource-links/README.md) owns recognition, configuration and routing behavior. [STATE](.intent/state/STATE.md) records intended behavior; [LOG](.intent/LOG.md) records executed evidence. The [ownership note](docs/agent-notes/resource-links-ownership.md) explains the direct transfer of Chat routing from the manager.

Build against an explicitly selected Harness after its Host and Client declarations, the file manager and the resource workbench are built:

```sh
pnpm install --ignore-scripts
DSH_CHECKOUT=/absolute/candidate/harness pnpm run build
DSH_CHECKOUT=/absolute/candidate/harness pnpm run typecheck
pnpm test
```

`DSH_CHECKOUT`, `DSH_HOME` and `DSH_PROFILE` are required for profile operations. Both setup and uninstall inspect by default. Setup `--install` applies the owned incremental Host patch, rebuilds its Host/browser artifacts and this plugin, and installs its Bundle with `dsh plugin add`; uninstall `--remove` verifies patch ownership, atomically removes the Bundle, reverses its patch and rebuilds the changed Host/browser artifacts. Neither command restarts a service. A failure stops at that step; earlier source/artifact changes remain visible for recovery. Use a private Home containing the target profile's complete plugin set for the first installation probe; package presence alone does not prove the browser can boot.

```sh
DSH_CHECKOUT=/absolute/candidate/harness DSH_HOME=/absolute/private-home DSH_PROFILE=web pnpm run setup
DSH_CHECKOUT=/absolute/candidate/harness DSH_HOME=/absolute/private-home DSH_PROFILE=web pnpm run setup --install
DSH_CHECKOUT=/absolute/candidate/harness DSH_HOME=/absolute/private-home DSH_PROFILE=web pnpm run uninstall --check
```

The profile must already compose the file manager, generic resource workbench and right sidebar. Those plugins own their respective installation transactions. Do not hand-edit profile dependency or Bundle JSON. Setup requires the adapter patch maintained in this repository; it does not adopt historical patches owned by other plugins.
