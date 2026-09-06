import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import * as host from '../src/index.ts'
import * as client from '../src/client/index.ts'
import type { ChatTextLinks } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

it('validates bounds and registers a single Host provider without feature UIs', async () => {
  expect(() => host.Config({ openMode: 'invalid' })).toThrow()
  for (const name of ['maxResolveBatchSize', 'maxTextReadBytes', 'maxByteReadBytes', 'maxBatchSize', 'cacheTtlMs', 'maxCacheEntries', 'maxPendingPaths', 'maxCandidatesPerText']) {
    expect(() => host.Config({ [name]: 0 })).toThrow()
    expect(() => host.Config({ [name]: 1.5 })).toThrow()
  }
  const ctx = new Context()
  ctx.provide('sessions', { get: () => undefined } as never)
  ctx.provide('sessionPersistence', {} as never)
  const fiber = ctx.plugin(host, {})
  try {
    await fiber.await()
    expect(ctx.userFiles.metadata()).toEqual(host.Config({}))
    expect(ctx.userFiles.metadata().enabled).toBe(false)
  } finally { await fiber.dispose() }
  expect(ctx.get('userFiles')).toBeUndefined()
})

it.each([false, true])('mounts userFiles once with Links enabled=%s and no sidebar/viewer/manager', async enabled => {
  const ctx = new Context()
  const unmount = vi.fn(async () => {})
  const mount = vi.fn(async () => unmount)
  const sessionId = 'plugin-session' as SessionId
  const native = vi.fn(async () => ({ ok: true, value: undefined }))
  const files = {
    metadata: async () => ({ ok: true, value: host.Config({ enabled, batchDelayMs: 0, maxResolveBatchSize: 1 }) }),
    resolve: async () => ({ ok: true, value: { path: '/canonical/a.md', name: 'a.md', kind: 'file' } }),
    resolveMany: vi.fn(async ({ paths }: { paths: string[] }) => ({ ok: true, value: paths.map(inputPath => ({ inputPath, ok: true, value: { path: `/canonical/${inputPath}`, name: inputPath, kind: 'file' } })) })),
  }
  ctx.provide('remote', { $mount: mount, userFiles: files, session: { canOpenWorkspacePath: async () => ({ ok: true, value: true }), openWorkspacePath: native } } as never)
  ctx.provide('remote.session', ctx.remote.session as never)
  ctx.provide('remote.userFiles', files as never)
  ctx.provide('sessions', { list: { getSnapshot: () => ({ byId: { [sessionId]: { cwd: '/workspace' } } }) }, open: vi.fn() } as never)
  const fiber = ctx.plugin(client)
  try {
    await fiber.await()
    expect(ctx.get('workspaceFileOpenPolicy')).toEqual({ mode: 'preview' })
    const links = ctx.get('chatTextLinks') as ChatTextLinks | undefined
    if (enabled) {
      expect(links).toBeDefined()
      expect((await Promise.all(['a.md', 'b.md'].map(path => links!.resolve(sessionId, path, 'inline-code')))).flat()).toHaveLength(2)
      expect(files.resolveMany.mock.calls.map(call => call[0].paths)).toEqual([['a.md'], ['b.md']])
      await links!.open(sessionId, 'a.md')
      expect(native).toHaveBeenCalledTimes(1)
    } else {
      expect(links).toBeUndefined()
      expect(files.resolveMany).not.toHaveBeenCalled()
    }
    expect(mount).toHaveBeenCalledTimes(1)
    expect(mount.mock.calls[0]?.[0]).toMatchObject({ package: '@dsh-external/dsh-user-files' })
  } finally { await fiber.dispose() }
  expect(ctx.get('chatTextLinks')).toBeUndefined()
  expect(ctx.get('workspaceFileOpenPolicy')).toBeUndefined()
  expect(unmount).toHaveBeenCalledTimes(1)
})
