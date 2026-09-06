/** Host-owned configuration for the browser resource-link policy. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { UserFileFilesystem } from './filesystem.ts'
import { UserFileRemote } from './remote.ts'
export { UserFileFilesystem, UserFileFilesystemError, UserFileConfirmationRequiredError, normalizedAbsolute, resolveUserPath } from './filesystem.ts'
export { UserFileRemote } from './remote.ts'
export type * from './types.ts'
import type { UserFileMetadata } from './types.ts'

export const name = 'user-files'
export const inject = ['sessions', 'sessionPersistence']
export type Config = UserFileMetadata

/** All deployment-varying bounds are validated before mounting the Remote. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(false),
  maxResolveBatchSize: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(128),
  maxTextReadBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(1048576),
  maxByteReadBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(16777216),
  streamChunkBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(262144),
  openMode: z.union(['preview', 'system'] as const).default('preview'),
  batchDelayMs: z.number().step(1).min(0).max(2147483647).default(10),
  maxBatchSize: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(128),
  cacheTtlMs: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(5000),
  maxCacheEntries: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(2048),
  maxPendingPaths: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(4096),
  maxCandidatesPerText: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(256),
})

/** Mount the single authenticated file provider independently of UI features. */
export function apply(ctx: Context, config: Config): void {
  new UserFileRemote(ctx, new UserFileFilesystem(config.maxTextReadBytes, config.maxByteReadBytes), config)
}
