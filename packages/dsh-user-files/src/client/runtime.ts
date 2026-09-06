/** Session-scoped metadata discovery and the optional inline-code discovery. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ChatTextLinks, TextLink } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { UserFileResolvedPath, UserFileResolveManyResult } from '@dsh-external/dsh-user-files/types'
import type { UserFileMetadata } from '../types.ts'
import { candidates, filesystemTarget, sessionTarget } from './parse.ts'

/** Injected services; no text or byte reads are available to discovery. */
export interface Gateway {
  readonly cwd: (sessionId: SessionId) => string | undefined
  readonly knownSession: (sessionId: SessionId) => boolean
  readonly resolveMany: (sessionId: SessionId, paths: readonly string[], signal: AbortSignal) => Promise<readonly UserFileResolveManyResult[]>
  readonly resolve: (sessionId: SessionId, path: string, signal: AbortSignal) => Promise<UserFileResolvedPath>
  readonly openFile: (sessionId: SessionId, path: string, signal: AbortSignal) => Promise<void>
  readonly openSession: (sessionId: SessionId) => void
}

interface Pending {
  readonly key: string
  readonly sessionId: SessionId
  readonly cwd: string | undefined
  readonly path: string
  readonly promise: Promise<UserFileResolvedPath | undefined>
  readonly finish: (value: UserFileResolvedPath | undefined) => void
}

/** One plugin lifetime; batches execute serially and failures never enter the cache. */
export class ResourceLinksRuntime implements ChatTextLinks {
  private readonly cache = new Map<string, { expires: number; value: UserFileResolvedPath }>()
  private readonly pending = new Map<string, Pending>()
  private readonly queue: Pending[] = []
  private readonly controllers = new Set<AbortController>()
  private readonly tasks = new Set<Promise<unknown>>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private draining = false
  private disposed = false

  /** @param gateway Injected metadata and navigation operations. @param config Validated limits, capped to provider metadata. @param now Instance-local clock for cache expiry. */
  constructor(private readonly gateway: Gateway, private readonly config: UserFileMetadata, private readonly now: () => number = () => performance.now()) {}

  /** @param sessionId Source session. @param text Displayed source. @param mode Markdown context; only inline-code discovers filesystem paths. @returns Existing resource ranges; discovery failures stay inert. */
  async resolve(sessionId: SessionId, text: string, mode: Parameters<ChatTextLinks['resolve']>[2]): Promise<readonly TextLink[]> {
    if (this.disposed) return []
    const found = candidates(text, mode, this.config.maxCandidatesPerText)
    const links = await Promise.all(found.map(async item => {
      const session = sessionTarget(item.target)
      if (session !== undefined) return this.gateway.knownSession(session as SessionId) ? item : undefined
      const cwd = this.gateway.cwd(sessionId)
      const path = filesystemTarget(item.target)
      if (!this.gateway.knownSession(sessionId) || path === undefined) return undefined
      const value = await this.lookup(sessionId, cwd, path)
      if (this.disposed || this.gateway.cwd(sessionId) !== cwd) return undefined
      return value !== undefined && (value.kind === 'file' || value.kind === 'directory') ? item : undefined
    }))
    return this.disposed ? [] : links.filter((item): item is NonNullable<typeof item> => item !== undefined)
  }

  /** @param sessionId Source session. @param target Complete destination. @returns Completion of explicit navigation; preserves resolution/open errors. */
  async open(sessionId: SessionId, target: string): Promise<void> {
    this.assertActive()
    const session = sessionTarget(target)
    if (session !== undefined) {
      if (!this.gateway.knownSession(session as SessionId)) throw new Error(`Unknown session: ${session}`)
      this.gateway.openSession(session as SessionId)
      return
    }
    const path = filesystemTarget(target)
    if (path === undefined) throw new Error(`Unsupported resource target: ${target}`)
    await this.track(async signal => {
      // Clicks revalidate metadata even when the displayed link came from a successful cache entry.
      const resolved = await this.gateway.resolve(sessionId, path, signal)
      this.assertActive()
      if (resolved.kind !== 'file' && resolved.kind !== 'directory') throw new Error(`Unsupported filesystem resource: ${resolved.path}`)
      await this.gateway.openFile(sessionId, resolved.path, signal)
    })
  }

  /** Cancel owned requests, settle discovery waiters, and await the transport's cancellation completion. */
  async dispose(): Promise<void> {
    this.disposed = true
    clearTimeout(this.timer)
    this.timer = undefined
    this.cache.clear()
    this.queue.length = 0
    for (const item of this.pending.values()) item.finish(undefined)
    this.pending.clear()
    for (const controller of this.controllers) controller.abort()
    await Promise.allSettled([...this.tasks])
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('Resource links plugin is disposed')
  }

  private async track<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController()
    this.controllers.add(controller)
    const task = (async () => await run(controller.signal))()
    this.tasks.add(task)
    try { return await task } finally { this.tasks.delete(task); this.controllers.delete(controller) }
  }

  private lookup(sessionId: SessionId, cwd: string | undefined, path: string): Promise<UserFileResolvedPath | undefined> {
    const key = JSON.stringify([sessionId, cwd, path])
    const cached = this.cache.get(key)
    if (cached !== undefined) {
      if (cached.expires > this.now()) return Promise.resolve(cached.value)
      this.cache.delete(key)
    }
    const existing = this.pending.get(key)
    if (existing !== undefined) return existing.promise
    if (this.pending.size >= this.config.maxPendingPaths) return Promise.resolve(undefined)
    let finish!: Pending['finish']
    const promise = new Promise<UserFileResolvedPath | undefined>(resolve => { finish = resolve })
    const item: Pending = { key, sessionId, cwd, path, promise, finish }
    this.pending.set(key, item)
    this.queue.push(item)
    if (!this.draining && this.timer === undefined) {
      this.timer = setTimeout(() => { this.timer = undefined; void this.drain() }, this.config.batchDelayMs)
    }
    return promise
  }

  private async drain(): Promise<void> {
    this.draining = true
    try {
      while (!this.disposed && this.queue.length > 0) {
        const first = this.queue.shift()!
        const batch = [first]
        for (let i = 0; i < this.queue.length && batch.length < this.config.maxBatchSize;) {
          const item = this.queue[i]!
          if (item.sessionId === first.sessionId && item.cwd === first.cwd) batch.push(...this.queue.splice(i, 1))
          else i++
        }
        let results: readonly UserFileResolveManyResult[] = []
        try {
          results = await this.track(signal => this.gateway.resolveMany(first.sessionId, batch.map(item => item.path), signal))
        } catch {
          // Discovery is optional presentation: transport failures leave text inert and retryable.
        }
        for (let i = 0; i < batch.length; i++) {
          const item = batch[i]!
          const result = results[i]
          const value = !this.disposed && this.gateway.cwd(item.sessionId) === item.cwd && result?.ok === true && result.inputPath === item.path ? result.value : undefined
          if (value !== undefined) {
            while (this.cache.size >= this.config.maxCacheEntries) this.cache.delete(this.cache.keys().next().value!)
            this.cache.set(item.key, { expires: this.now() + this.config.cacheTtlMs, value })
          }
          this.pending.delete(item.key)
          item.finish(value)
        }
      }
    } finally { this.draining = false }
  }
}
