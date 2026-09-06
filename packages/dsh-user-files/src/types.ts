import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Opaque revision produced by an exact content and metadata read. */
export type UserFileRevision = string

/** File kinds shown in the browser tree after following a symbolic link when possible. */
export type UserFileEntryKind = 'file' | 'directory' | 'other' | 'missing'

/** Session-relative or absolute path request. */
export interface UserFilePathRequest {
  readonly sessionId: SessionId
  readonly path: string
}

/** Text read with explicit permission to exceed the configured confirmation threshold. */
export interface UserFileReadTextRequest extends UserFilePathRequest {
  /** True only after the user confirms large-file access; applies to this request alone. */
  readonly allowLargeFile?: boolean
}

/** File or encoded replacement size requiring explicit user confirmation. */
export interface UserFileConfirmationRequiredDetails {
  readonly path: string
  readonly sizeBytes: number
  readonly thresholdBytes: number
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The text file or encoded replacement needs explicit large-file confirmation. */
    'user-files/confirmation-required': UserFileConfirmationRequiredDetails
  }
}

/** Metadata-only path batch, bounded by maxResolveBatchSize. */
export interface UserFileResolveManyRequest {
  readonly sessionId: SessionId
  readonly paths: readonly string[]
}

/** One result per input path, preserving order and duplicate inputs. */
export type UserFileResolveManyResult =
  | { readonly inputPath: string; readonly ok: true; readonly value: UserFileResolvedPath }
  | { readonly inputPath: string; readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** Resolved existing path and followed kind. */
export interface UserFileResolvedPath {
  readonly path: string
  readonly kind: UserFileEntryKind
  readonly name: string
  readonly size?: number
  readonly modifiedAtMs?: number
  readonly mediaType?: string
}

/** Canonical LF text and the opaque revision needed for a guarded save. */
export interface UserFileTextDocument {
  readonly path: string
  readonly text: string
  readonly version: UserFileRevision
}

/** Exact bounded bytes encoded for JSON transport with their opaque content revision. */
export interface UserFileBytesDocument {
  readonly path: string
  readonly dataBase64: string
  readonly version: UserFileRevision
}

/** Guarded byte-save request encoded for the JSON Remote transport. */
export interface UserFileSaveBytesRequest extends UserFilePathRequest {
  readonly dataBase64: string
  readonly version: UserFileRevision
}

/** Guarded text-save request. */
export interface UserFileSaveRequest extends UserFileReadTextRequest {
  readonly text: string
  readonly version: UserFileRevision
}

/** Opaque revision after a successful replacement. */
export interface UserFileSaveResult { readonly version: UserFileRevision }

/** Validated deployment policy delivered by the Host metadata Remote. */
export interface UserFileMetadata {
  readonly maxResolveBatchSize: number
  /** Inclusive text size accepted without explicit large-file confirmation. */
  readonly maxTextReadBytes: number
  readonly maxByteReadBytes: number
  /** Enable automatic inline-code discovery. File access remains available. */
  readonly enabled: boolean
  /** Explicit destination for filesystem resources; resolution precedes either route. */
  readonly openMode: 'preview' | 'system'
  /** Coalescing delay for metadata requests across displayed text nodes. */
  readonly batchDelayMs: number
  /** Maximum paths per request, additionally capped by the provider's advertised limit. */
  readonly maxBatchSize: number
  /** Successful metadata lifetime in milliseconds. Failures are never cached. */
  readonly cacheTtlMs: number
  /** Maximum successful entries retained across sessions and workspaces. */
  readonly maxCacheEntries: number
  /** Maximum distinct queued and in-flight paths; excess discovery remains inert. */
  readonly maxPendingPaths: number
  /** Maximum candidates considered in one displayed text node. */
  readonly maxCandidatesPerText: number
}
