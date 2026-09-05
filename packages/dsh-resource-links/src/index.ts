/** Host-owned configuration for the browser resource-link policy. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { ResourceLinksConfig } from './types.ts'

export const name = 'resource-links'
export type Config = ResourceLinksConfig

/** All deployment-varying bounds are validated before mounting the Remote. */
export const Config: z<Config> = z.object({
  openMode: z.union(['preview', 'system'] as const).default('preview'),
  batchDelayMs: z.number().step(1).min(0).max(2147483647).default(10),
  maxBatchSize: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(128),
  cacheTtlMs: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(5000),
  maxCacheEntries: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(2048),
  maxPendingPaths: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(4096),
  maxCandidatesPerText: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(256),
})

/** Authenticated configuration projection; owns no filesystem operations. */
export class ResourceLinksRemote extends TypertRemoteService {
  /** @param ctx Host plugin context. @param config Validated deployment values. */
  constructor(ctx: Context, private readonly config: ResourceLinksConfig) {
    super(ctx, 'resourceLinks', { namespace: 'resourceLinks' })
  }

  /** @returns Browser routing and metadata discovery limits. */
  @Remote('metadata')
  metadata(): ResourceLinksConfig { return this.config }
}

/** @param ctx Host context. @param config Validated configuration. */
export function apply(ctx: Context, config: Config): void {
  new ResourceLinksRemote(ctx, config)
}
