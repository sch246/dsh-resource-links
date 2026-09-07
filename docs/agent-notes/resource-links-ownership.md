# Shared user-file and opening ownership

`@dsh-external/dsh-user-files` owns authenticated file resolution, content reads and one shared queue for canonical file publication and directory mutations. Manager owns directory operations and reuses the shared resolver. Viewer owns its filesystem resource source. Optional Links owns parsed-inline-code discovery and invokes the common Host opener; it has no viewer/sidebar dependency, descriptor identity or opening listener.

The Host adapter owns `openWorkspaceFile`, its waterfall request and opaque Markdown display support. It combines the former viewer Chat contribution and former Links increment. Verified baseline tree: `e3ab00b1c9db5a5dde2835e61626c1959ccaa388`; adapted Host commit: `04060ec8a6a46c194354ae402fadd4d800e29409`; original opening/Markdown patch SHA-256: `35a955b4274080b09d6638d5e27ccedf5863dbe692a3274bef103160e2d7bd32`. Sidebar and Typert changes are excluded. The previous Links patch is preserved under `patches/history/resource-links.patch`.

New installations use `dsh-user-files.patch-state`. Existing `dsh-resource-links.patch-state` and viewer receipts remain historical evidence until an explicit coordinated transfer verifies their actual contributed source. The ownership helper cannot manufacture that transfer. The skill-manager-owned Typert external-project support remains in the Host while any out-of-tree generator consumes it.

Links cancellation reaches metadata and the common native opening request. A handler failure remains terminal. Disabled Links mounts the file namespace and common opening policy without path discovery. Configuration migration belongs to STATE; live activation and browser acceptance are separate from source and artifact tests.

The adapter additionally carries conversation-scoped attachment file drops. The digest above identifies the original opening/Markdown contribution, not the expanded patch. Use the current patch bytes and the selected Host receipt for installation identity; [drop ownership](scoped-file-drops.md) describes the additional source owners.
