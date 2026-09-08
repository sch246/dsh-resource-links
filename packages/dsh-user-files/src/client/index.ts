/** Mount authenticated file access and optional inline-code links. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import { openWorkspaceFile } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import userFilesRemote from '@dsh-external/dsh-user-files/remote'
import { ResourceLinksRuntime } from './runtime.ts'

export const inject = ['remote']

function valueOf<T>(result: RemoteResult<T>): T {
  if (result.ok) return result.value
  throw result.error
}

/** @param ctx Browser plugin context. @returns Namespace and discovery disposer. */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmount = await ctx.remote.$mount(userFilesRemote)
  const fiber = ctx.inject(['remote.userFiles'], async ctx => {
    const config = valueOf(await ctx.remote.userFiles.metadata())
    ctx.provide('workspaceFileOpenPolicy', { mode: config.openMode })
    if (!config.enabled) return
    const links = ctx.inject(['sessions', 'remote.session'], ctx => {
      const runtime = new ResourceLinksRuntime({
        cwd: sessionId => ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd,
        knownSession: sessionId => ctx.sessions.list.getSnapshot().byId[sessionId] !== undefined,
        resolveMany: async (sessionId, paths, signal) => valueOf(await ctx.remote.userFiles.resolveMany({ sessionId, paths }, signal)),
        resolve: async (sessionId, path, signal) => valueOf(await ctx.remote.userFiles.resolve({ sessionId, path }, signal)),
        openFile: (sessionId, path, signal, textSelection) => openWorkspaceFile(ctx, { sessionId, path, preview: true, signal, ...(textSelection === undefined ? {} : { textSelection }) }),
        openSession: sessionId => { ctx.sessions.open(sessionId) },
      }, { ...config, maxBatchSize: Math.min(config.maxBatchSize, config.maxResolveBatchSize) })
      ctx.effect(() => () => runtime.dispose())
      ctx.provide('chatTextLinks', runtime)
    })
    return () => links.dispose()
  })
  try { await fiber } catch (error) { await fiber.dispose(); await unmount(); throw error }
  return async () => { await fiber.dispose(); await unmount() }
}
