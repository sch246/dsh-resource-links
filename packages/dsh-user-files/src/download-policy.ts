/** Deployment policy for bounded browser-to-disk downloads. */
export interface UserFileDownloadPolicy {
  readonly downloadConcurrency: number
  readonly downloadChunkBytes: number
  readonly downloadRetries: number
  readonly downloadTimeoutMs: number
}
/** Defaults supplied by the configurable Host schema. */
export const defaultDownloadPolicy: UserFileDownloadPolicy = {
  downloadConcurrency: 4, downloadChunkBytes: 1048576, downloadRetries: 2, downloadTimeoutMs: 30000,
}
