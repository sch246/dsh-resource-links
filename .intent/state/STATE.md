# Resource links installation and behavior map

Recorded deployment: [managed activation](../logs/2026-09-05-managed-activation.md) describes a locally installed and activated Web service after private validation and explicit user authorization. It does not certify another checkout or current browser state. This local STATE is not the meta-intent protocol; no user visual acceptance or accepted realization lock is claimed. [LOG](../LOG.md) retains executed evidence, including the private uninstall/reinstall recovery.

## User intent and provenance

Source: Codex task **评估网页文件查看编辑能力 (2)**, conversation `01a07134-78e5-7503-83c1-059bc388eecf`, actual user messages. Times use **Asia/Shanghai (UTC+08:00)**, converted from message UTC timestamps. The first message pastes user/GPT dialogue; assistant suggestions inside it are proposals, not separate user instructions.

- September 5 20:50: “点击会话链接现在打不开了” requests repair of explicit session navigation. “如果一个文件或目录路径可以找到那么就让它可以点击” and “点击目录和文件分别打开文件管理器和文件编辑器” establish metadata-backed discovery and resource-specific opening.
- September 5 20:55: “存在的路径都能点击这个功能是很独立的” and “值得做一个依赖right-sidebar的插件了” establish this independent plugin. September 5 20:56: “进行实现和修复” authorizes implementation. Dependency on the sidebar does not give this plugin ownership of grouping or editor rendering.

The September 6 correction restricts automatic filesystem discovery to actual Markdown inline-code nodes, excluding the ordinary `/` between `write` and `edit`, bare prose, fences, escaped backticks and unmatched backticks. `/` and `.` receive no unconditional-link exception: target-Host parsing and successful metadata resolution remain required.

The user's broad existing-path goal is implemented through bounded candidate syntax and metadata checks, detailed below. It does not mean every ambiguous word, inaccessible path or unquoted filename containing spaces can be recognized. `preview|system` and no automatic error fallback are recorded implementation decisions in the [ownership note](../../docs/agent-notes/resource-links-ownership.md), not verbatim user requests.

## Intended dependencies and pending migration

The September 6 user correction, “可联动不意味着必依赖”, governs the target composition. Links becomes an optional feature of the shared authenticated user-file provider. That provider supplies path resolution and metadata without requiring sidebar, viewer or manager UI. Viewer and manager independently consume shared file access and sidebar placement; neither feature requires the other or Links. Storing the provider package in an existing repository does not make that repository's UI package a dependency. The extraction and profile migration are pending; the installation map below records the current executable requirements.

| Relationship | Target requirement or optional integration | Current implementation |
| --- | --- | --- |
| Links → shared file provider | Required for authoritative path confirmation; the Links toggle controls discovery only. | Metadata still comes from `remote.fileManager`. |
| Links → Host Chat/open API | Required for display and shared file-open requests. | The Host adapter supplies text decoration; this plugin owns opening policy. |
| Links → sidebar, viewer, manager UI | Optional integrations through the common opening request; no imports or mandatory injection of these features. | All three currently gate Client registration and must remain installed until cutover. |
| File click → viewer or manager | Viewer may handle supported files; manager may handle directories. With no handler, use native opening; a handler error propagates. | This plugin directly calls the workbench or Files launcher. |

Migration preserves current link availability by enabling Links for installations that already include resource-links, then removes the old Bundle and its provider/listener. There must be one discovery provider and one shared file provider. Disabling Links leaves shared file access and existing explicit file/session links available. Automatic discovery accepts only parsed inline code and metadata-confirmed paths, with no special acceptance for `/` or `.`. Package versions remain independent; compatibility means supported APIs and declared ranges, never equal version numbers. [Migration record](../logs/2026-09-06-dependency-intent.md) records this documentation-only update.

## Installation map

This section describes the implementation before the shared-provider cutover. Its required composition is a migration constraint, not the intended permanent dependency graph.

### Dependencies and contribution owners

| Owner | Contribution and prerequisite |
| --- | --- |
| Harness Web and Session services | Supply Chat display, known-session navigation, authenticated Remotes and optional native opening. Build the selected Host/Client declarations and Typert generator before this plugin; development dependencies target `0.1.2-alpha.2`. |
| `@dsh-external/dsh-right-sidebar` | Must be built and composed first. Owns groups, layout and Files launcher placement. |
| `@dsh-external/dsh-file-viewer` plus editor | Must be built and installed through the viewer's joint transaction. Viewer owns generic resource opening and handler selection; editor is a plain dependency, not another Bundle. |
| `@dsh-external/dsh-file-manager` | Must be built and composed after viewer/sidebar. Owns metadata resolution, content access, filesystem source and Files selector. The matching manager has no Chat listener or `openMode` field. |
| Resource-links Bundle | [Manifest](../../packages/dsh-resource-links/package.json) declares the Client providers; [Bundle patch](../../packages/dsh-resource-links/cordis.patch.yml) supplies validated configuration. [Client registration](../../packages/dsh-resource-links/src/client/index.ts) provides `chatTextLinks` and the sole plugin listener for `chat/open-workspace-file`. Its Host metadata Remote supplies deployment policy, without accessing filesystem contents. |
| Resource-links Host adapter | [Incremental Harness patch](../../patches/deepseek-harness.patch) adds the optional Chat text resolver, serializable ranges/rendering callbacks and supporting ui-primitives rendering. It routes the workspace `.` action through the existing waterfall. Host presentation does not implement path recognition or filesystem policy. |

The [repository guide](../../README.md) owns build/profile command examples; the [package reference](../../packages/dsh-resource-links/README.md) owns exact recognition syntax, configuration fields and runtime limits. Development `link:` dependencies expect sibling manager, viewer and sidebar checkouts. The profile must resolve and compose those providers; installing this Bundle does not perform their owned installation transactions.

### Installation and removal entry points

All profile operations require explicit `DSH_CHECKOUT`, `DSH_HOME` and `DSH_PROFILE`. Use the selected Host and complete sibling package composition in a private Home for a first installation, and preserve unrelated profile configuration. The owned commands never restart services.

| Operation | Entry and actual effects |
| --- | --- |
| Inspect | [Setup](../../scripts/setup.sh), `pnpm run setup --check`, checks patch ownership and profile consistency without changing either. Omitted mode also checks. |
| Install/update | `pnpm run setup --install` applies the owned increment, rebuilds affected Harness artifacts, builds plugin Host/Remote/Client, calls `dsh plugin add` for its package directory, and verifies exact profile/receipt state. |
| Inspect removal | [Uninstall](../../scripts/uninstall.sh), `pnpm run uninstall --check`, checks the same ownership and profile state. |
| Remove | `pnpm run uninstall --remove` checks the patch, removes its dependency through the source CLI, verifies profile absence, clears only this checkout's exact residual symlink, reverses the receipt-owned increment and rebuilds affected Harness artifacts. Other plugin dependencies remain. |

[Profile verification](../../scripts/profile-state.mjs) compares the absolute linked target in the manifest, lockfile and installed package, plus Bundle and composed row counts. It can resume dependency removal when the package transaction has completed but its symlink remains. A foreign symlink or real directory is retained and reported as a conflict. A failure stops at that step; setup is not a cross-repository rollback transaction, and preceding source/artifact changes remain for recovery.

[Adapter rebuilding](../../scripts/build-host-adapter.sh) regenerates the Client catalog, compiles and bundles ui-primitives, ui-chat and cordis-client-runner, then builds the static Web shell. Run it through the owned lifecycle path after adding or removing the adapter so stale generated/browser artifacts cannot preserve the removed contribution. Remove resource-links before manager, viewer/editor or sidebar when dismantling the complete workbench; other consumers can still require those providers. Activation is a separate authorized operation after disk state is coherent.

### Host baseline and receipt limits

[Patch ownership](../../scripts/host-patch.mjs) uses `dsh-resource-links.patch-state` in the selected checkout's Git metadata. The receipt records patch digest, Host root, Host HEAD at creation and operation state. Inspection validates digest/root and patch applicability; the recorded HEAD is provenance, not an assertion that no Host commit has changed. Interrupted operations and drift remain explicit recovery states.

The inline-code adapter revision is checked against Host `8baca648bac8eb295a6f613204adf7298c31480d`, over the exact `4c3c55bc849c3012158f98c628f797c359ce779b` snapshot and its attributable inverse-patch baseline. Its full forward and reverse tree checks are recorded in LOG. This source verification does not reconcile an installed receipt with the changed patch digest.

The patch is incremental over the earlier Chat waterfall visible in its removed/context lines. That initial contribution is retained in the [viewer historical patch](https://github.com/sch246/dsh-file-viewer/blob/main/patches/deepseek-harness.patch), which overlaps these Chat files and gives `.` a direct native route. Current viewer and manager scripts neither apply that historical patch nor transfer its receipt. The managed activation log explicitly records that historical receipts were not changed. Thus the recorded resource-links receipt owns its increment, not all historical changes in the same files.

An already-applied patch without this receipt is rejected; reverse applicability alone cannot prove adoption. On a new Host or after upstream changes, inspect the baseline and all affected receipt owners, adapt only the attributable increment, and preserve unrelated edits. Do not apply or reverse the viewer patch wholesale over the incremental adapter. Removing resource-links restores its prior Host baseline, including the earlier waterfall; it is not proof that every workbench-related Host change has been removed. The current scripts provide no historical-receipt transfer command and the logs do not establish a clean arbitrary Host installation.

### Preparing a Host that lacks the baseline

This is a controlled adaptation route beyond the current installer, not an already-tested clean-Host command sequence.

1. In an isolated Harness checkout, compare the selected Host against the historical viewer patch's `packages/client/ui-chat/src/client/contract/slots.ts` hunk (`ChatFileOpenRequest` and `Events['chat/open-workspace-file']`), `src/client/index.ts` type export, and `src/client/apply.ts` hunks (`openNativeWorkspacePath` and `ChatViewInjected.openFile`). Reuse equivalent native APIs when present; reconstruct only missing semantics. The companion `tests/apply-inject.client.spec.tsx`, ui-chat README pair and `2026-09-05-chat-workspace-file-open-waterfall` note pair identify error/delegation and initial `.` behavior. The final resource-links increment deliberately replaces the `.` bypass with the same waterfall used by files.
2. Treat the historical patch's entire `packages/typert/generator/` portion separately: `WorkspaceAnalyzerOptions.externalProjectReferences`, `WorkspaceTypertGeneratorOptions.externalProjectReferences`, their implementations and external-project regression supply out-of-tree Remote analysis. The [viewer installation ownership record](https://github.com/sch246/dsh-file-viewer/blob/main/.intent/logs/2026-09-05-live-web-install.md) says this directory was excluded because skill-manager already owned it. Check the [skill-manager installation map](https://github.com/sch246/dsh-skill-manager/blob/main/.intent/state/STATE.md) and its receipt before changing these files. Preserve that owner's contribution; if the selected Host lacks the capability entirely, implement the missing shared capability with explicit ownership rather than claiming it as a resource-links removal target.
3. Prepare a reviewed adaptation diff and an ownership record naming the selected Host revision, exact contributed files/symbols, upstream-equivalent and excluded hunks, other receipt owners, generated outputs and intended reversal order. Record the new Chat baseline separately from this plugin's incremental patch digest; do not manufacture an applied receipt to bypass the script. If adapting the increment itself, update its attributable patch and deployment evidence together. Existing installations with drift require reconciliation against their original recorded patch before its receipt can be replaced.
4. Build shared Host prerequisites and the sidebar/viewer/manager providers, then run the owned resource-links installation against the candidate baseline and complete private profile. Verify handled/delegated/error waterfall behavior, the `.` directory path, session links and discovered files, and rehearse incremental removal back to the recorded baseline. Regenerate the catalogs and browser outputs through the owned adapter build. Publish only the reviewed attributable adaptation, never a snapshot of unrelated Host changes; managed activation remains separate from this reconstruction evidence.

## Stable behavior and current limits

The desired effect is reliable opening of existing paths and explicit session references without changing message content. The syntax coverage, queue strategy and suffix handling below describe the current implementation and its limits; they may improve as targets and feedback change. Do not treat an unsupported spelling as a permanent user exclusion or claim that the broad existing-path goal is already exhaustively covered.

- Only complete Markdown inline-code values may discover metadata-confirmed existing files and directories relative to the owning Session workspace. Prose and authored destinations retain explicit session references but never search for filesystem paths. Complete code values may preserve spaces and extensionless names. Root and current-directory tokens are candidates only when the target Host resolves them; unsupported, nonexistent and inaccessible paths remain inert. Discovery never scans directories recursively or reads file contents.
- Local `file:` URLs accept only an empty host or `localhost`. HTTP URLs, remote file hosts, email addresses and other schemes are outside filesystem discovery. Trailing line/column and `#Lline` syntax is stripped for opening; it does not position the editor cursor and reserves those suffixes against literal filename interpretation. Unicode offsets and balanced path punctuation remain valid.
- Explicit `dsh-session:` references navigate only to known sessions without filesystem lookup, retaining explicit display labels. Broken session references must not become filesystem or native-open attempts.
- Every click resolves fresh canonical metadata. `preview` opens files through the generic resource workbench with preview semantics and directories through the sidebar's `file-manager` launcher. `system` sends the resolved path to the optional native opener. Workbench handler choice and sidebar placement remain provider responsibilities.
- Explicit resolution, preview and native-opening failures retain their error and the Host's in-page retry presentation. No arbitrary failure invokes an OS fallback. An explicit external-open action remains available when the filesystem source supports it. The obsolete `preview-or-system` policy is rejected rather than silently mapped; manager must not retain its old listener or configuration.
- Configuration bounds candidate counts, queue capacity, request sizes, cache capacity/lifetime and coalescing delay. The effective batch size is capped to the manager limit. Requests deduplicate by Session identity, current CWD and path; only one metadata batch is in flight. Successful results are cached; transient errors are not. A known Session without projected CWD still delegates to the manager's authoritative workspace fallback. CWD changes suppress stale results.
- Capacity overflow leaves discovery inert until a later request. Disposal clears timers/cache, settles pending discovery, aborts requests and awaits completion. Host rendering suppresses stale completions and resolves settled assistant text. Recognition and rendering affect displayed text only: original message source, Session logs and model inputs are unchanged.

## Acceptance observations

These are behavior to verify on the selected composition, not claims that this documentation update ran them.

- Existing absolute, relative and spaced paths inside actual inline code become links after Host confirmation; directories mount Files, text files mount the selected editor, and an image uses the matching handler. Nonexistent/inaccessible and ambiguous candidates remain plain text. Selecting a session reference changes the addressed session without filesystem resolution.
- A discovered file deleted before clicking produces the original not-found error and sends no native-open request; restoration followed by Retry can succeed. `system` and an unavailable native opener follow their explicit policy, and handler failures do not bypass it.
- Repeated displayed candidates coalesce within the configured bounds; CWD changes and disposal cannot publish stale links or leave active requests. The manager owns all metadata reads and remains the sole filesystem authority.
- A cold composed Web loads exactly one resource-links contribution with the intended manager/viewer/sidebar providers, usable links and no relevant loader or browser errors. Setup checks matching profile targets and owned patch state; removal/reinstallation handles the exact residual-link case and regenerates affected catalogs/bundles without removing other owners' changes.

## Evidence limits

The linked execution and managed-activation logs retain candidate tests, cold-browser observations and the recovered private removal probe. They do not establish user visual acceptance, portability to an arbitrary Host or transfer of historical receipts. The September 6 candidate regression evidence is recorded in LOG; it does not establish deployment or browser acceptance.
