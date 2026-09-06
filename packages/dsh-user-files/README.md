# @dsh-external/dsh-user-files

One authenticated Node provider serves `ctx.userFiles` and the generated `remote.userFiles` namespace. It requires Session and Remote services, independently of sidebar, viewer and manager. The Client mounts its namespace even when Links is disabled and provides the common Host opening policy. Only `enabled: true` contributes `chatTextLinks`; this package never registers a file-open waterfall listener.

The public `types` export owns `UserFilePathRequest`, `UserFileResolvedPath`, ordered `UserFileResolveManyResult`, `UserFileReadTextRequest`, text/byte documents and guarded save requests/results. `resolve` and `resolveMany` read metadata only. Session-relative paths use the live Session header or persisted Session metadata, then the service process cwd when the header has none. Absolute paths are not restricted to the workspace. Authenticated UI operations use service-process permissions, independently of agent filesystem or approval policy.

Text reads and saves use `maxTextReadBytes` as an inclusive confirmation threshold. Above it, requests without `allowLargeFile: true` fail with typed Remote error `user-files/confirmation-required` and details `{ path, sizeBytes, thresholdBytes }`. Existing file size is checked from metadata before content is read, including the save revision check. Local replacement text may grow beyond the threshold without another confirmation; the published revision is returned regardless of that growth. A confirmed request can read or save larger text without a provider size cap. Confirmation applies only to that request, including saves and refresh reads; it does not change byte-operation limits.

Text reads reject malformed UTF-8, NUL bytes and non-regular files, normalize CRLF/CR to LF, and retain the original EOL convention in the opaque revision. Saves preserve terminal-newline presence and existing mixed-EOL positions. Byte reads/saves preserve exact bytes through base64 JSON transport. Text and byte saves plus manager directory mutations enter one provider-owned queue; saves resolve canonical paths inside their transaction, stage beside the target, compare the exact content SHA-256 and stat revision, then rename atomically. Uncooperative external writes between the final check and rename cannot be prevented by ordinary filesystem APIs. Cancellation after successful rename does not report a failed publication.

| Config | Default | Meaning |
| --- | --- | --- |
| `enabled` | `false` | Enable automatic inline-code file links. |
| `openMode` | `preview` | Common opening policy: handlers then native, or `system` to bypass handlers. |
| `maxResolveBatchSize` | `128` | Inclusive metadata request count. |
| `maxTextReadBytes` | `1048576` | Inclusive existing text-file bytes loaded without confirmation. |
| `maxByteReadBytes` | `16777216` | Inclusive byte read/save bytes. |
| `batchDelayMs` | `10` | Coalescing delay, including zero. |
| `maxBatchSize` | `128` | Discovery batch count, capped to the provider limit. |
| `cacheTtlMs` | `5000` | Successful metadata cache lifetime. |
| `maxCacheEntries` | `2048` | Successful cache capacity. |
| `maxPendingPaths` | `4096` | Queued and in-flight distinct paths. |
| `maxCandidatesPerText` | `256` | Candidates per displayed node. |

Links examines complete parsed Markdown inline-code values. Prose, escaped/unmatched backticks, fences and authored file destinations do not discover paths. Absolute paths, relative paths, extensionless basenames and spaces are accepted for Host confirmation. `/` and `.` follow the same metadata rule. Local `file:` URLs permit an empty host or localhost; remote file hosts, HTTP and email addresses are excluded. `:line[:column]` and `#Lline` suffixes are reserved position syntax and stripped; cursor placement is not provided.

Known `dsh-session:` references retain labels and navigate without filesystem lookup when Links is enabled. Every file click resolves fresh canonical metadata and calls the common Host opener with cancellation and preview intent. Files and directories require no feature-specific descriptor or launcher knowledge. Resolution, handler and native failures propagate. Native opening runs on the service-process machine.

Discovery deduplicates by Session, projected cwd and path. Missing projected cwd delegates to Host Session resolution. Successful metadata alone is cached; transient failures retry. Workspace changes suppress stale results. One batch runs at a time. Disposal settles queued discovery, aborts active requests and awaits completion. No message source, Session log or model input is changed.

The `install` export provides `planUserFilesInstall` for compatible provider reuse within consumer setup transactions, and `assertUserFilesRemovable` to protect remaining declared consumers. Exactly one provider Bundle owns the graph row. Each consumer declares a compatible API range; package versions need not match. The repository [installation map](../../.intent/state/STATE.md) owns configuration and Host-patch migration.
