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
  /** Inclusive existing-file ceiling, as a positive safe integer; omission leaves confirmed reads unlimited. */
  readonly maxConfirmedBytes?: number
}

/** Metadata-only plan for independently retryable raw-byte chunks; readVersion is a stat fingerprint, not a save revision. */
export interface UserFileTextReadPlan {
  readonly path: string
  readonly sizeBytes: number
  readonly chunkBytes: number
  readonly readVersion: string
}

/** One aligned raw-byte offset in a prepared file, carrying approval on every request. */
export interface UserFileTextChunkRequest extends UserFileReadTextRequest {
  readonly readVersion: string
  readonly offset: number
}

/** Exact raw bytes and their lowercase SHA-256; text decoding requires the assembled file. */
export interface UserFileTextChunk {
  readonly offset: number
  readonly dataBase64: string
  readonly sha256: string
}

/** Validate the complete current text against the prepared stat fingerprint and establish a save revision. */
export interface UserFileFinishTextReadRequest extends UserFileReadTextRequest {
  readonly readVersion: string
}

/** Existing text file size requiring explicit user confirmation. */
export interface UserFileConfirmationRequiredDetails {
  readonly path: string
  readonly sizeBytes: number
  readonly thresholdBytes: number
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** Loading the existing text file needs explicit large-file confirmation. */
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
  /** Exact disk byte count before EOL normalization. */
  readonly sizeBytes: number
}

/** Ordered provisional text fragments; only complete supplies a validated guarded-save revision. */
export type UserFileTextStreamEvent =
  | { readonly kind: 'start'; readonly path: string; readonly sizeBytes: number }
  | { readonly kind: 'chunk'; readonly text: string; readonly bytesRead: number }
  | { readonly kind: 'complete'; readonly version: UserFileRevision; readonly sizeBytes: number }

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

/** Resolved Save As target; an existing regular file carries its exact overwrite revision. */
export interface UserFileTextSaveAsPlan {
  readonly path: string
  readonly name: string
  readonly exists: boolean
  readonly revision?: UserFileRevision
}

/** Canonical LF document for an absent target or an explicitly revision-guarded overwrite. */
export interface UserFileSaveAsRequest extends UserFileReadTextRequest {
  readonly text: string
  /** Omission requires an absent target at atomic publication. */
  readonly expectedRevision?: UserFileRevision
}

/** Published Save As identity and complete canonical content metadata. */
export interface UserFileSaveAsResult extends UserFilePatchResult {
  readonly path: string
  readonly name: string
}

/** Original zero-based LF-token range; terminated lines include LF and an empty document has no tokens. */
export interface UserFileTextPatch {
  readonly startLine: number
  /** Positive token count; zero is permitted only at position zero of an empty canonical file. */
  readonly lineCount: number
  /** Lowercase SHA-256 of the exact canonical old range, including its terminal LF when present. */
  readonly expectedHash: string
  /** Canonical LF replacement, without NUL, CR or malformed UTF-16. */
  readonly replacement: string
}

/** Ordered disjoint ranges checked together against current disk content; no whole-document base revision. */
export interface UserFilePatchRequest extends UserFileReadTextRequest {
  /** Empty ranges return current metadata without writing. */
  readonly ranges: readonly UserFileTextPatch[]
}

/** Published metadata without complete document content. */
export interface UserFilePatchResult {
  readonly version: UserFileRevision
  readonly sizeBytes: number
  /** Lowercase SHA-256 of the actual complete canonical LF output, excluding its UTF-8 BOM. */
  readonly canonicalHash: string
}

/** Delta observation from a path-scoped canonical content hash. */
export interface UserFileDeltaRequest extends UserFileReadTextRequest {
  readonly baseHash: string
  /** Optional positive safe-integer result-byte ceiling, capped by provider maxDeltaBytes. */
  readonly maxPatchBytes?: number
  /** Only background requests use the non-queueing provider admission permit. */
  readonly background?: boolean
}

/** Bounded delta outcome; automatic callers never receive complete text as a fallback. */
export type UserFileDeltaResult =
  | ({ readonly kind: 'unchanged' } & UserFilePatchResult)
  | ({ readonly kind: 'patch'; readonly ranges: readonly UserFileTextPatch[] } & UserFilePatchResult)
  | { readonly kind: 'manual-required'; readonly reason: 'base-missing' | 'too-large' | 'diff-budget' }
  | { readonly kind: 'busy' }

/** Opaque revision after a successful replacement. */
export interface UserFileSaveResult {
  readonly version: UserFileRevision
  /** Exact published disk bytes, supplied by this provider for text and byte saves. */
  readonly sizeBytes?: number
}

/** Deployment-owned budgets for automatic text deltas and canonical baseline retention. */
export interface UserFileDeltaPolicy {
  /** Optional native acceleration; omission resolves to auto for standalone callers. */
  readonly diffBackend?: 'auto' | 'builtin' | 'hdiffpatch'
  /** Executable name or path, without shell arguments; omission resolves to hdiffz. */
  readonly hdiffpatchCommand?: string
  readonly maxDeltaBytes: number
  readonly baselineBytes: number
  readonly baselineEntries: number
  readonly deltaConcurrency: number
  readonly deltaDiffTimeoutMs: number
  readonly deltaMaxEditLength: number
}

/** Validated deployment policy delivered by the Host metadata Remote. */
export interface UserFileMetadata extends UserFileDeltaPolicy {
  readonly maxResolveBatchSize: number
  /** Inclusive text size accepted without explicit large-file confirmation. */
  readonly maxTextReadBytes: number
  /** Inclusive raw HTTP upload bound; independent of the buffered byte-RPC limit. */
  readonly maxUploadBytes: number
  readonly maxByteReadBytes: number
  /** Maximum raw bytes per sequential text stream read. */
  readonly streamChunkBytes: number
  /** Raw bytes per independently retryable text chunk, bounded for Buffer and base64 allocation. */
  readonly textReadChunkBytes: number
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
