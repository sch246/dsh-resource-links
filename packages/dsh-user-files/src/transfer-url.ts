/** Browser-safe URL construction for shared authenticated binary transfers. */
import type { UserFilePathRequest } from './types.ts'

/** Exact HTTP endpoint; available when the provider has Connection and WebServer services. */
export const USER_FILE_TRANSFER_PATH = '/api/user-files/transfer'

/** Binary transfer target and browser presentation request. */
export interface UserFileTransferRequest extends UserFilePathRequest {
  /** PUT child filename; path identifies its parent directory. */
  readonly name?: string
  /** Defaults to attachment. Inline is honored only for PDF and approved passive image types. */
  readonly disposition?: 'inline' | 'attachment'
}

/** @param request Session, path and optional upload name or presentation. @returns Same-origin cookie-authenticated HTTP URL without credentials in its query. */
export function userFileTransferUrl(request: UserFileTransferRequest): string {
  return `${USER_FILE_TRANSFER_PATH}?${new URLSearchParams({
    sessionId: request.sessionId,
    path: request.path,
    ...(request.name === undefined ? {} : { name: request.name }),
    ...(request.disposition === undefined ? {} : { disposition: request.disposition }),
  })}`
}
