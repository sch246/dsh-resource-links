/** Validated deployment policy delivered by the Host metadata Remote. */
export interface ResourceLinksConfig {
  /** Explicit destination for filesystem resources; resolution precedes either route. */
  readonly openMode: 'preview' | 'system'
  /** Coalescing delay for metadata requests across displayed text nodes. */
  readonly batchDelayMs: number
  /** Maximum paths per request, additionally capped by the manager's advertised limit. */
  readonly maxBatchSize: number
  /** Successful metadata lifetime in milliseconds. Failures are never cached. */
  readonly cacheTtlMs: number
  /** Maximum successful entries retained across sessions and workspaces. */
  readonly maxCacheEntries: number
  /** Maximum distinct queued and in-flight paths; excess discovery remains inert. */
  readonly maxPendingPaths: number
  /** Maximum candidates considered in one displayed text node. */
  readonly maxCandidatesPerText: number
}
