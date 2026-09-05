import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import * as host from '../src/index.ts'
import * as client from '../src/client/index.ts'
import type { ChatTextLinks } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

it('validates all configured bounds and unregisters the Host metadata service', async () => {
  expect(() => host.Config({ openMode: 'preview-or-system' })).toThrow()
  for (const name of ['maxBatchSize', 'cacheTtlMs', 'maxCacheEntries', 'maxPendingPaths', 'maxCandidatesPerText']) {
    expect(() => host.Config({ [name]: 0 })).toThrow()
    expect(() => host.Config({ [name]: 1.5 })).toThrow()
  }
  expect(() => host.Config({ batchDelayMs: -1 })).toThrow()
  const ctx = new Context()
  const fiber = ctx.plugin(host, {})
  try {
    await fiber.await()
    expect((ctx.get('resourceLinks') as host.ResourceLinksRemote).metadata()).toEqual(host.Config({}))
  } finally { await fiber.dispose() }
  expect(ctx.get('resourceLinks')).toBeUndefined()
})

it('mounts only its own Remote and removes the resolver and Chat listener on disposal', async () => {
  const ctx = new Context()
  const unmount = vi.fn(async () => {})
  const mount = vi.fn(async () => unmount)
  const system = vi.fn()
  const open = vi.fn(async () => 'view')
  const sessionId = 'plugin-session' as SessionId
  const manager = {
    metadata: async () => ({ ok: true, value: { maxResolveBatchSize: 1 } }),
    resolve: async () => ({ ok: true, value: { path: '/canonical/a.md', name: 'a.md', kind: 'file' } }),
    resolveMany: vi.fn(async ({ paths }: { paths: string[] }) => ({ ok: true, value: paths.map(inputPath => ({ inputPath, ok: true, value: { path: `/canonical/${inputPath}`, name: inputPath, kind: 'file' } })) })),
  }
  const metadata = { metadata: async () => ({ ok: true, value: host.Config({ batchDelayMs: 0 }) }) }
  const sessionRemote = { openWorkspacePath: system }
  ctx.provide('remote', { $mount: mount, resourceLinks: metadata, fileManager: manager, session: sessionRemote } as never)
  ctx.provide('remote.resourceLinks', metadata as never)
  ctx.provide('remote.fileManager', manager as never)
  ctx.provide('remote.session', sessionRemote as never)
  ctx.provide('sessions', { list: { getSnapshot: () => ({ byId: { [sessionId]: { cwd: '/workspace' } } }) }, open: vi.fn() } as never)
  ctx.provide('rightSidebar', { launch: vi.fn() } as never)
  ctx.provide('resourceWorkbench', { open } as never)
  const fiber = ctx.plugin(client)
  try {
    await fiber.await()
    const links = ctx.get('chatTextLinks') as ChatTextLinks
    expect(links).toBeDefined()
    expect(await links.resolve(sessionId, 'a.md b.md', 'text')).toHaveLength(2)
    expect(manager.resolveMany.mock.calls.map(call => call[0].paths)).toEqual([['a.md'], ['b.md']])
    await ctx.waterfall('chat/open-workspace-file', { sessionId, path: 'a.md' }, async () => {})
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ ref: expect.objectContaining({ resourceId: '/canonical/a.md' }) }), { preview: true })
    expect(system).not.toHaveBeenCalled()
    expect(mount).toHaveBeenCalledTimes(1)
    expect(mount.mock.calls[0]?.[0]).toMatchObject({ package: '@dsh-external/dsh-resource-links' })
  } finally { await fiber.dispose() }
  expect(ctx.get('chatTextLinks')).toBeUndefined()
  expect(unmount).toHaveBeenCalledTimes(1)
  open.mockClear()
  await ctx.waterfall('chat/open-workspace-file', { sessionId, path: 'a.md' }, async () => {})
  expect(open).not.toHaveBeenCalled()
})
