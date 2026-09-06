/** Deployment-owned budgets for automatic text deltas and canonical baseline retention. */
import type { UserFileDeltaPolicy } from './types.ts'

/** Defaults projected into validated provider Config and standalone filesystem construction. */
export const defaultDeltaPolicy: UserFileDeltaPolicy = {
  maxDeltaBytes: 1048576,
  baselineBytes: 268435456,
  baselineEntries: 16,
  deltaConcurrency: 1,
  deltaDiffTimeoutMs: 100,
  deltaMaxEditLength: 10000,
}
