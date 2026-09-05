# Resource links

Status: candidate implementation validated in a private Web profile; not installed in the managed Web service or user-accepted. Executed evidence is recorded in [LOG](../LOG.md).

Displayed message text may link existing filesystem paths relative to the owning session workspace. Files open through the resource workbench; directories open the file manager through the right sidebar. Explicit session references navigate to their session. Recognition and routing belong to this plugin, not to the text editor or file manager.

Filesystem checks use metadata only, with bounded batches and cache lifetimes. Nonexistent, inaccessible, and ambiguous prose remains inert. Explicit link failures retain their original error and do not automatically fall through to an OS opener. Native opening remains an explicit configuration option or an available resource action.

Opening policy is `preview|system`; both first resolve fresh canonical metadata. The plugin replaces the file manager's Chat listener and its `preview-or-system` policy at combined cutover. Deployment limits are validated on the Host and delivered through one metadata Remote. Client metadata requests deduplicate by session identity, CWD and path; disposal clears and cancels the complete owned queue.

The Host contributes only an optional, session-scoped text-link resolver and rendering callbacks. It neither reads the filesystem nor embeds extension-specific parsing. Message source and session logs are unchanged.

Setup and uninstall inspect by default and never restart services. Explicit removal verifies profile absence before clearing this checkout's exact residual package symlink, reverses only its receipt-owned Host patch, and regenerates the Client catalog and browser artifacts. Drift, foreign links and real directories block removal without deleting the conflicting target.
