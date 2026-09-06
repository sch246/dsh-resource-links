# @dsh-external/dsh-resource-links

The Host validates deployment configuration and exposes it through `remote.resourceLinks.metadata`. The browser contributes `chatTextLinks` and owns `chat/open-workspace-file`. The manager owns filesystem metadata and content access; this plugin never reads file content, recursively scans directories, rewrites message source or appends session events.

Automatic filesystem discovery only examines complete values of Markdown `inlineCode` nodes supplied by the Host as `inline-code` mode. Bare or quoted prose, escaped or unmatched backticks, fenced code and authored Markdown file destinations do not trigger filesystem lookup. Inline code accepts absolute POSIX paths, `./` and `../` paths, slash-containing relative paths, filenames and extensionless basenames; complete values may contain spaces. `/` and `.` are candidates, never guaranteed links: the target Host must support and resolve them as existing files or directories. Local `file:` URLs allow an empty host or `localhost`; remote file hosts, HTTP URLs, other schemes and email addresses remain outside filesystem discovery. `:line[:column]` and `#Lline` positions are stripped for opening; this plugin does not move an editor cursor. These trailing forms are reserved position syntax: literal filenames ending in them cannot be addressed through this adapter. UTF-16 ranges and balanced path punctuation are retained.

Only metadata-confirmed files and directories become discovered links. Missing and inaccessible paths remain plain text; transient failures are not cached. Explicit `dsh-session:` references must name a known session and navigate through the session service without filesystem lookup. `@[label](dsh-session:id)` retains its display label.

Explicit `open()` requests accept paths independently of automatic discovery, including the existing Chat file actions. Every click resolves fresh canonical metadata. In `preview` mode, files open through the generic workbench with `preview: true`, and directories launch `file-manager` in the right sidebar. Handler selection belongs to the workbench. In `system` mode, the resolved canonical path goes to the optional Host native opener; unavailable native opening rejects. Resolution and preview errors propagate to the Host's in-page retry presentation. No error triggers an automatic native fallback. The workbench's explicit external-open action remains available when the filesystem source advertises it.

| Bundle config | Default | Meaning |
| --- | --- | --- |
| `openMode` | `preview` | `preview` or `system`; both resolve first. |
| `batchDelayMs` | `10` | Non-negative integer coalescing delay, at most the timer's signed 32-bit maximum. |
| `maxBatchSize` | `128` | Positive integer paths per request, capped to manager metadata. |
| `cacheTtlMs` | `5000` | Positive integer successful metadata lifetime. |
| `maxCacheEntries` | `2048` | Positive integer cache capacity. |
| `maxPendingPaths` | `4096` | Positive integer distinct queued and in-flight path capacity. |
| `maxCandidatesPerText` | `256` | Positive integer candidate count per display node. |

Only one metadata batch is in flight per plugin instance. Pending paths deduplicate across text nodes by source session, its current CWD and path; the same identity keys successful cache entries. Known sessions without a projected CWD still delegate resolution to the manager, whose Host workspace fallback remains authoritative; missing CWD has a distinct cache identity. CWD changes suppress stale in-flight results. Capacity overflow remains inert until a later resolution request. Disposal clears timers and cache, settles pending discovery, aborts requests and awaits their completion. The Host owns stale-render suppression and only asks for settled assistant text.

The configuration is one Bundle row in `cordis.patch.yml`; profile overrides replace its complete `config`. `preview-or-system` is intentionally rejected. Migrate that old manager policy to explicit `preview` here and use the resource workbench's external action when desired. The matching manager must remove its Chat listener and `openMode` config so there is one routing owner.

Model experience: none. Message source, session logs, model inputs and cache behavior are unchanged. This candidate still requires combined private-Home boot and browser acceptance with its Host adapter and sibling plugins.
