# Resource links installation and maintenance map

Use this map to realize clickable paths on the selected Harness and to maintain that behavior as the Host, environment and user needs change. It supplies intended effects, source locations and an adaptation route. [User feedback and implementation evidence](../logs/2026-09-06-dependency-intent.md) explain its decisions; [LOG](../LOG.md) and the [activation record](../logs/2026-09-05-managed-activation.md) describe particular executions. Those records do not certify another environment.

## Behavior to provide

Links is an optional feature of shared authenticated user-file access. It requires path resolution, metadata and Host text-link/opening APIs; it does not require sidebar, viewer or manager UI. Sharing a repository or supporting another feature is not a required package dependency. Keep one shared file provider and one enabled discovery provider in a profile. Disabling Links stops automatic path discovery while retaining file access, original session-file actions, HTTP links and explicit session navigation.

Only actual parsed Markdown inline-code nodes may discover files. Resolve the complete code value relative to its owning Session through the target Host, and decorate it only after successful metadata confirmation. Ordinary prose, fenced code, escaped or unmatched backticks and authored Markdown file destinations do not trigger discovery. `/` and `.` have no special acceptance rule: unsupported, nonexistent and inaccessible targets stay plain text. The ordinary slash between `write` and `edit` remains ordinary text. Do not infer the service machine's filesystem from the browser platform.

Explicit `dsh-session:` references navigate only to known sessions without filesystem lookup, retaining their labels. Broken session references do not become file-open attempts. Recognition changes displayed text only, never message source, Session logs or model input.

All file clicks use the common Host opening request. Viewer can handle supported files, manager can handle directories, and absent handlers delegate to the native opener on the service-process machine. A handler that accepts the request preserves its error rather than invoking a fallback. Carry preview, pin and placement intent through this request without exposing viewer descriptors or manager launcher ids to Links. Without either UI feature, confirmed links still offer system opening and report unavailable native opening visibly.

Large text files require an explicit confirmation opportunity rather than a permanent refusal. Shared file access checks the existing file size before reading content and reports the actual size and configured threshold when confirmation is needed. Confirmation governs loading existing disk content, including save revision checks. Local edits may grow beyond the threshold and save successfully without another prompt; byte operations retain their configured bound. Consumers carry explicit confirmation and any confirmed size ceiling on related text requests. If unseen disk content grows beyond that ceiling, metadata triggers another confirmation before loading it. Consumers using the ceiling declare a compatible provider range starting at version 0.1.1, so installation rejects a provider that ignores it. Read and save responses provide exact disk byte counts so consumers can track size without repeatedly encoding local edits. Preserve cancellation and guarded-save behavior. The [package reference](../../packages/dsh-user-files/README.md) owns the request flag and typed error fields.

Progressive text loading delivers metadata before content, sequential canonical-text fragments with raw-byte progress, and a validated revision only after the complete file is read. Keep partial content provisional and discard it on failure; cancellation or early consumer exit releases the file. Consumers requiring this stream API declare a compatible provider range starting at version 0.1.2. The provider configuration owns the raw read chunk size. Complete-document reads remain available for consumers that need them.

## Installation map

### Select capabilities and configuration

1. Read the selected Host revision, worktree changes, profile manifest, resolved package paths, Bundle rows and effective configuration. Use explicit `DSH_CHECKOUT`, `DSH_HOME` and `DSH_PROFILE`. Consult execution logs only for relevant source ownership or environment evidence; do not replay an entire historical installation.
2. Locate authenticated Session-relative file resolution and metadata on the Host. Reuse a compatible shared user-file provider or prepare one independently of manager UI. Service-process permissions govern this UI access; agent `ctx.fs`, sandbox and tool approval are separate. A package can live within an existing repository while being built and distributed independently.
3. Find the Host's text-decoration and open-request APIs. Use the existing `chat/open-workspace-file` waterfall where available; do not create a second routing registry. Give the renderer an explicit parsed-inline-code mode rather than recovering Markdown context from text fragments. The Host presentation API carries opaque targets and ranges, not filesystem policy.
4. Compose the shared provider once. Enable Links when requested; when preserving an installation already using automatic path links, preserve that enabled behavior. Include viewer or manager only for their requested UI features. Resolve compatible API ranges across consumers; package versions need not be equal. Prefer independently consumable artifacts, with explicit local overrides for development.
5. Read the effective discovery limits and opening behavior before changing a deployment. Preserve unrelated fields when rewriting complete profile configuration rows. A Links toggle must not disable the shared file provider or explicit file actions. Map any existing `preview|system` preference to its corresponding common opening behavior rather than silently discarding it.

### Source and operation entry points

| Resource | Use when adapting the selected implementation |
| --- | --- |
| [Filesystem](../../packages/dsh-user-files/src/filesystem.ts), [Remote](../../packages/dsh-user-files/src/remote.ts) and [request types](../../packages/dsh-user-files/src/types.ts) | Locate confirmation thresholds, typed errors, exact revisions and atomic text/byte saves. |
| [Parser](../../packages/dsh-user-files/src/client/parse.ts) and [runtime](../../packages/dsh-user-files/src/client/runtime.ts) | Candidate syntax, Session navigation, bounded metadata batching/cache and fresh resolution on click. Preserve these behaviors when placing Links in the shared provider. |
| [Client registration](../../packages/dsh-user-files/src/client/index.ts) | Locate dependency injection, the text-link provider and opening listener. Compose only capabilities needed by Links; route opens through Host APIs. |
| [Manifest](../../packages/dsh-user-files/package.json) and [Bundle](../../packages/dsh-user-files/cordis.patch.yml) | Locate package exports, Client entries and configuration. Establish one owner for each graph row and namespace in the actual composition. |
| [Repository guide](../../README.md) and [package reference](../../packages/dsh-user-files/README.md) | Concrete build commands, parser/configuration fields and implementation limits. Check their applicability to the chosen source and feature composition. |
| [Setup](../../scripts/setup.sh) and [uninstall](../../scripts/uninstall.sh) | Inspection defaults and explicit `--install` / `--remove` operations. Read effects and prerequisites before use; adapt a script that assumes unnecessary feature packages rather than installing those features to satisfy it. |
| [Profile verification](../../scripts/profile-state.mjs) | Compare manifest, lockfile, actual linked target, Bundle and composed row counts after a transaction. |
| [Adapter build](../../scripts/build-host-adapter.sh) | Regenerate Client catalogs and affected Host/browser artifacts after source changes; generated output is a projection of surviving owners. |

Build selected Host declarations and required generator support before plugin Host/Remote/Client artifacts. Repository-local development links are locators, not portable installation requirements. Use `dsh plugin` transactions for package resolution and Bundle changes. Inspect the actual script when moving the feature into a shared package so add/remove acts on the correct owner and retains shared services used by other consumers.

### Host baseline and receipt limits

Inspect the [Host patch](../../patches/deepseek-harness.patch), [ownership helper](../../scripts/host-patch.mjs) and selected checkout's `dsh-user-files.patch-state` receipt and any historical `dsh-resource-links.patch-state` receipt together. Compare recorded root, digest, contributed source and operation state. Recorded HEAD identifies provenance; it does not prove the current tree equals that revision. Reuse equivalent upstream APIs and adapt only missing behavior. An applied patch without a matching receipt needs attribution from source and records; reverse applicability alone does not establish ownership.

The [viewer patch](https://github.com/sch246/dsh-file-viewer/blob/main/patches/deepseek-harness.patch) and [skill-manager installation map](https://github.com/sch246/dsh-skill-manager/blob/main/.intent/state/STATE.md) are investigation inputs for shared Chat and Typert support. Inspect each hunk and current consumer separately. Preserve `externalProjectReferences` wherever out-of-tree generators use it; inspect `rootDir/commonDirectory` behavior separately rather than treating whole generator patches as equivalent. Filesystem UI features need not depend on skill-manager as a feature merely because its installation contributed shared Host support.

Before applying, transferring or removing support, identify its sole owner, retained consumers and exact contributed source. Record that attribution with the applicable baseline and receipt. Never reverse a whole historical patch to remove one feature, manufacture a receipt to suppress drift, or remove a shared capability still in use.

### Preparing a Host that lacks the baseline

1. Locate the selected Host's Markdown renderer, Chat text-link definition and file-open action. Compare `ChatFileOpenRequest`, `Events['chat/open-workspace-file']`, the client exports and `openNativeWorkspacePath` semantics against the implementation references. Preserve delegation through `next()`, visible errors and workspace-directory opening through the same request.
2. Supply the missing renderer mode and opaque link callback support in the Host's equivalent extension points. Keep path syntax and metadata in the file provider. Consolidate related Host support under one attributable adapter so business packages do not require sequential patches of the same Chat code.
3. Prepare required out-of-tree Remote generation separately from Chat. Check actual generator callers and the existing owners before changing source. Regenerate declarations and catalogs from the adapted source rather than borrowing stale generated output.
4. Build the chosen composition in isolated candidate paths and a private Home when changing boot dependencies. Preserve the selected profile's unrelated packages and complete configuration. Check the installed resolution and browser flow before activating the managed service.

## Recognition and operation details

- Discovery reads metadata only, never file content or recursive directory listings. Complete inline-code values can preserve spaces and extensionless names. Bounded candidate syntax may evolve with verified Host behavior and user feedback; an unsupported spelling is not a permanent product exclusion.
- Local `file:` URLs use an empty host or `localhost`; HTTP URLs, remote file hosts and email addresses are not filesystem candidates. The parser reference owns line/column suffix and punctuation rules. Keep UTF-16 ranges aligned with the rendered value and preserve original labels.
- Deduplicate metadata requests by Session, current workspace and path. Validate configurable candidate, queue, batch, cache and timing limits against the provider's limits. Successful results may be cached; transient failures are not. Workspace changes suppress stale results. A Session without projected CWD delegates to the provider's authoritative workspace resolution.
- Resolve metadata again on click. Deletion after decoration produces the original not-found error and a visible retry path. Do not mask resolution, preview or native-open errors with another opening route.
- Disposal settles queued discovery, cancels active work and clears owned timers/cache. Superseded rendering cannot publish stale links. Capacity overflow leaves discovery inert until a later request.

## Verify and maintain

Observe the behavior affected by the operation: a real inline file becomes clickable after Host confirmation; the prose slash between two code nodes remains inert; invalid inline tokens cause no open; explicit session and HTTP navigation remain usable. Check Links without viewer/manager/sidebar, and check optional handlers only when composed. Confirm native opening or its visible failure when no handler accepts a request. Use existing focused tests where they answer the question cheaply; simple browser actions need no elaborate automation or A/B experiment.

After package changes, verify the resolved path, lockfile, Bundle and composed rows together. After Host changes, regenerate affected catalogs and browser outputs and check that each contribution appears once. Installation and service activation are separate operations. Removal disables the owned discovery contribution and removes only unused package/Host support; preserve shared consumers, unrelated profile fields and user data.

When execution or user feedback contradicts this map, record the observation and its circumstances in LOG, then refine the behavior or operational guidance supported by that evidence. Keep debt inventories, implementation progress and execution results in logs. STATE must remain sufficient for an unfamiliar model to locate, install, adapt and maintain every requested feature.

## Coordinated configuration and ownership migration

The runtime artifact is `@dsh-external/dsh-user-files` in this repository. Preserve the effective old resource-links configuration as a complete user-files row and set `enabled: true`; a new installation defaults to false. Preserve `openMode` exactly as the common opening policy. Move manager `maxResolveBatchSize`, `maxTextReadBytes` and `maxByteReadBytes` to that row. Move manager `resourcePollIntervalMs` unchanged to the complete viewer row, preserving other viewer fields; manager retains `directoryPollIntervalMs`, `deleteMode` and `moveCommand`. Read effective profile and Home overlays before rewriting whole rows. Remove the old resource-links Bundle/provider and manager content/source registrations in the same candidate combination.

The current Host adapter combines the initial viewer Chat waterfall, Links text-decoration support and the common cancellable opener. Its exact baseline and patch hash are recorded in the ownership note. Preserve old Links and viewer patches and receipts before transfer. Existing source plus old receipts must be attributed hunk by hunk; the new ownership helper refuses automatic adoption. Do not reverse a whole old viewer patch or remove separately owned Typert `externalProjectReferences`. Uninstallation may remove the shared adapter only when user-files has no declared consumers.
