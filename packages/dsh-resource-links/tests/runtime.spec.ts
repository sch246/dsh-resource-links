import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { FileManagerResolvedPath } from '@dsh-external/dsh-file-manager/types'
import { ResourceLinksRuntime, type Gateway } from '../src/client/runtime.ts'
import type { ResourceLinksConfig } from '../src/types.ts'

const id = 'session-1' as SessionId
const second = 'session-2' as SessionId
const config: ResourceLinksConfig = {
  openMode: 'preview', batchDelayMs: 10, maxBatchSize: 2,
  cacheTtlMs: 100, maxCacheEntries: 2, maxPendingPaths: 4, maxCandidatesPerText: 10,
}
const file = (path: string): FileManagerResolvedPath => ({ path, name: path.split('/').at(-1)!, kind: 'file' })
const runtimes: ResourceLinksRuntime[] = []

function fixture(overrides: Partial<Gateway> = {}, settings: Partial<ResourceLinksConfig> = {}) {
  let now = 0
  let cwd = '/workspace'
  const gateway: Gateway = {
    cwd: () => cwd,
    knownSession: session => session === id || session === second,
    resolveMany: vi.fn(async (_session, paths) => paths.map(inputPath => ({ inputPath, ok: true as const, value: file(`/workspace/${inputPath}`) }))),
    resolve: vi.fn(async (_session, path) => file(`/canonical/${path}`)),
    openResource: vi.fn(async () => {}), openDirectory: vi.fn(async () => {}),
    openSession: vi.fn(), openSystem: vi.fn(async () => {}), ...overrides,
  }
  const runtime = new ResourceLinksRuntime(gateway, { ...config, ...settings }, () => now)
  runtimes.push(runtime)
  return { runtime, gateway, tick: () => { now += 101 }, changeCwd: () => { cwd = '/other' } }
}

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(runtime => runtime.dispose()))
  vi.useRealTimers()
})

describe('metadata-backed routing', () => {
  it.each(['ENOENT', 'EACCES'])('preserves %s and never invokes native opening', async code => {
    const error = { code, message: code }
    const { runtime, gateway } = fixture({ resolve: async () => { throw error } }, { openMode: 'system' })
    await expect(runtime.open(id, '.')).rejects.toBe(error)
    expect(gateway.openSystem).not.toHaveBeenCalled()
    expect(gateway.openResource).not.toHaveBeenCalled()
  })

  it('routes files through the generic workbench and directories through the selector', async () => {
    const { runtime, gateway } = fixture()
    await runtime.open(id, './a.md:12:3')
    expect(gateway.resolve).toHaveBeenCalledWith(id, './a.md', expect.any(AbortSignal))
    expect(gateway.openResource).toHaveBeenCalledWith({ ref: { sessionId: id, sourceId: 'filesystem', resourceId: '/canonical/./a.md' }, name: 'a.md', kind: 'file' })
    vi.mocked(gateway.resolve).mockResolvedValue({ path: '/canonical/dir', name: 'dir', kind: 'directory' })
    await runtime.open(id, './dir')
    expect(gateway.openDirectory).toHaveBeenCalledWith(id, '/canonical/dir')
    expect(gateway.openSystem).not.toHaveBeenCalled()
  })

  it('uses canonical paths for explicit native mode and never falls back on viewer failure', async () => {
    const system = fixture({}, { openMode: 'system' })
    await system.runtime.open(id, './a.md')
    expect(system.gateway.openSystem).toHaveBeenCalledWith('/canonical/./a.md', expect.any(AbortSignal))
    const error = new Error('handler failed')
    const preview = fixture({ openResource: async () => { throw error } })
    await expect(preview.runtime.open(id, './a.md')).rejects.toBe(error)
    expect(preview.gateway.openSystem).not.toHaveBeenCalled()
  })

  it('validates session destinations without any filesystem calls', async () => {
    const { runtime, gateway } = fixture()
    expect(await runtime.resolve(id, 'dsh-session:session-2', 'target')).toHaveLength(1)
    expect(await runtime.resolve(id, 'dsh-session:unknown', 'target')).toEqual([])
    await runtime.open(id, 'dsh-session:session-2')
    expect(gateway.openSession).toHaveBeenCalledWith(second)
    await expect(runtime.open(id, 'dsh-session:unknown')).rejects.toThrow('Unknown session')
    expect(gateway.resolve).not.toHaveBeenCalled()
    expect(gateway.resolveMany).not.toHaveBeenCalled()
  })

  it('rejects unsupported targets and non-regular resources', async () => {
    const { runtime, gateway } = fixture({ resolve: async () => ({ path: '/socket', name: 'socket', kind: 'other' }) })
    await expect(runtime.open(id, 'https://host/file.md')).rejects.toThrow('Unsupported resource')
    await expect(runtime.open(id, '/socket')).rejects.toThrow('Unsupported filesystem')
    expect(gateway.openSystem).not.toHaveBeenCalled()
  })
})

describe('bounded discovery lifetime', () => {
  it('delegates known sessions without projected cwd to the manager and separates that cache identity', async () => {
    vi.useFakeTimers()
    let cwd: string | undefined
    const { runtime, gateway } = fixture({ cwd: () => cwd })
    const first = runtime.resolve(id, '/root/a@b.txt', 'target')
    await vi.runAllTimersAsync()
    expect(await first).toHaveLength(1)
    cwd = '/root'
    const second = runtime.resolve(id, '/root/a@b.txt', 'target')
    await vi.runAllTimersAsync()
    expect(await second).toHaveLength(1)
    expect(gateway.resolveMany).toHaveBeenCalledTimes(2)
    const directory = runtime.resolve(id, 'src', 'target')
    await vi.runAllTimersAsync()
    expect(await directory).toHaveLength(1)
  })
  it('deduplicates across text nodes and sends bounded batches', async () => {
    vi.useFakeTimers()
    const { runtime, gateway } = fixture()
    const a = runtime.resolve(id, 'a.md b.md c.md', 'text')
    const b = runtime.resolve(id, 'a.md d.md e.md', 'text')
    await vi.runAllTimersAsync()
    expect(await a).toHaveLength(3)
    expect(await b).toHaveLength(2)
    expect(vi.mocked(gateway.resolveMany).mock.calls.map(call => call[1])).toEqual([['a.md', 'b.md'], ['c.md', 'd.md']])
  })

  it('expires successful cache entries and isolates session and cwd identities', async () => {
    vi.useFakeTimers()
    const f = fixture()
    const resolve = async (session = id) => {
      const result = f.runtime.resolve(session, 'a.md', 'text')
      await vi.runAllTimersAsync()
      return await result
    }
    await resolve(); await resolve()
    expect(f.gateway.resolveMany).toHaveBeenCalledTimes(1)
    await resolve(second)
    f.changeCwd(); await resolve()
    f.tick(); await resolve()
    expect(f.gateway.resolveMany).toHaveBeenCalledTimes(4)
  })

  it('evicts at the configured cache bound and revalidates cached links on click', async () => {
    vi.useFakeTimers()
    const { runtime, gateway } = fixture({}, { maxCacheEntries: 1 })
    for (const path of ['a.md', 'b.md', 'a.md']) {
      const result = runtime.resolve(id, path, 'text')
      await vi.runAllTimersAsync(); await result
    }
    expect(gateway.resolveMany).toHaveBeenCalledTimes(3)
    const error = { code: 'ENOENT' }
    vi.mocked(gateway.resolve).mockRejectedValue(error)
    await expect(runtime.open(id, 'a.md')).rejects.toBe(error)
    expect(gateway.openSystem).not.toHaveBeenCalled()
  })

  it('does not cache missing paths or transport failures', async () => {
    vi.useFakeTimers()
    const { runtime, gateway } = fixture()
    vi.mocked(gateway.resolveMany).mockResolvedValueOnce([{ inputPath: 'a.md', ok: false, error: { code: 'ENOENT', message: 'missing' } }]).mockRejectedValueOnce(new Error('offline'))
    for (const expected of [0, 0, 1]) {
      const result = runtime.resolve(id, 'a.md', 'text')
      await vi.runAllTimersAsync()
      expect(await result).toHaveLength(expected)
    }
    expect(gateway.resolveMany).toHaveBeenCalledTimes(3)
  })

  it('discards in-flight old-cwd results', async () => {
    vi.useFakeTimers()
    let finish!: (value: Awaited<ReturnType<Gateway['resolveMany']>>) => void
    const f = fixture({ resolveMany: () => new Promise(resolve => { finish = resolve }) })
    const result = f.runtime.resolve(id, 'a.md', 'text')
    await vi.advanceTimersByTimeAsync(10)
    f.changeCwd()
    finish([{ inputPath: 'a.md', ok: true, value: file('/old/a.md') }])
    expect(await result).toEqual([])
  })

  it('disposal aborts in-flight metadata and settles pending text without late links', async () => {
    vi.useFakeTimers()
    let aborted = false
    const { runtime } = fixture({ resolveMany: (_id, _paths, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')) }, { once: true })
    }) })
    const result = runtime.resolve(id, 'a.md b.md c.md', 'text')
    await vi.advanceTimersByTimeAsync(10)
    await runtime.dispose()
    expect(aborted).toBe(true)
    expect(await result).toEqual([])
    expect(await runtime.resolve(id, 'a.md', 'target')).toEqual([])
    await expect(runtime.open(id, 'a.md')).rejects.toThrow('disposed')
  })

  it('disposing a queued batch prevents its timer from starting transport', async () => {
    vi.useFakeTimers()
    const { runtime, gateway } = fixture()
    const result = runtime.resolve(id, 'a.md', 'text')
    await runtime.dispose(); await vi.runAllTimersAsync()
    expect(await result).toEqual([])
    expect(gateway.resolveMany).not.toHaveBeenCalled()
  })
})
