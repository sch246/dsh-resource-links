/** Connect optional Host text adapters and Chat resource opens to metadata-backed routing. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@dsh-external/dsh-file-manager/remote'
import type {} from '@dsh-external/dsh-file-viewer/client'
import type {} from '@dsh-external/dsh-right-sidebar/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import resourceLinksRemote from '@dsh-external/dsh-resource-links/remote'
import { ResourceLinksRuntime } from './runtime.ts'

export const inject = ['remote']

function valueOf<T>(result: RemoteResult<T>): T {
  if (result.ok) return result.value
  throw result.error
}

/** @param ctx Browser plugin context. @returns Disposer for namespace, listeners, cache and requests. */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmount = await ctx.remote.$mount(resourceLinksRemote)
  const fiber = ctx.inject(['remote.resourceLinks', 'remote.fileManager', 'remote.session', 'sessions', 'rightSidebar', 'resourceWorkbench'], async ctx => {
    const [config, manager] = await Promise.all([
      ctx.remote.resourceLinks.metadata().then(valueOf),
      ctx.remote.fileManager.metadata().then(valueOf),
    ])
    const runtime = new ResourceLinksRuntime({
      cwd: sessionId => ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd,
      knownSession: sessionId => ctx.sessions.list.getSnapshot().byId[sessionId] !== undefined,
      resolveMany: async (sessionId, paths, signal) => valueOf(await ctx.remote.fileManager.resolveMany({ sessionId, paths }, signal)),
      resolve: async (sessionId, path, signal) => valueOf(await ctx.remote.fileManager.resolve({ sessionId, path }, signal)),
      openResource: descriptor => ctx.resourceWorkbench.open(descriptor, { preview: true }),
      openDirectory: (sessionId, path) => ctx.rightSidebar.launch(sessionId, 'file-manager', { path }),
      openSession: sessionId => { ctx.sessions.open(sessionId) },
      openSystem: async (path, signal) => { valueOf(await ctx.remote.session.openWorkspacePath({ path }, signal)) },
    }, { ...config, maxBatchSize: Math.min(config.maxBatchSize, manager.maxResolveBatchSize) })
    ctx.effect(() => () => runtime.dispose())
    ctx.provide('chatTextLinks', runtime)
    ctx.on('chat/open-workspace-file', request => runtime.open(request.sessionId, request.path))
  })
  try { await fiber } catch (error) { await fiber.dispose(); await unmount(); throw error }
  return async () => { await fiber.dispose(); await unmount() }
}
