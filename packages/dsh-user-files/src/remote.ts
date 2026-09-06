import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SessionPersistenceNotFoundError } from '@deepseek-ai/dsh-session-persistence'
import { Remote, RemoteError, remoteErrorOf, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  UserFileFilesystem, UserFileFilesystemError, UserFileConfirmationRequiredError, resolveUserPath,
} from './filesystem.ts'
import type { UserFilePatchRequest, UserFilePatchResult, UserFileMetadata, UserFileTextStreamEvent, UserFileReadTextRequest, UserFilePathRequest, UserFileResolvedPath, UserFileSaveBytesRequest, UserFileSaveRequest, UserFileSaveResult, UserFileTextDocument, UserFileBytesDocument, UserFileResolveManyRequest, UserFileResolveManyResult } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { userFiles: UserFileRemote }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The metadata batch exceeds the configured input count. */
    'user-files/batch-too-large': { readonly maxResolveBatchSize: number }
    /** The Session or addressed path does not exist. */
    'user-files/not-found': { readonly path: string; readonly sessionId?: SessionId }
    /** The addressed path or child name is invalid. */
    'user-files/invalid-path': { readonly path: string }
    /** The addressed path is not a directory. */
    'user-files/not-directory': { readonly path: string }
    /** The addressed path is not a regular file. */
    'user-files/not-file': { readonly path: string }
    /** The file is not UTF-8 text. */
    'user-files/not-text': { readonly path: string }
    /** The bytes exceed the configured byte-resource limit. */
    'user-files/too-large': {
      readonly path: string
      readonly maxTextReadBytes: number
      readonly maxByteReadBytes: number
    }
    /** A byte-write request did not contain canonical base64. */
    'user-files/invalid-bytes': { readonly path: string }
    /** A create or move destination already exists. */
    'user-files/already-exists': { readonly path: string }
    /** The loaded revision is no longer current. */
    'user-files/stale-version': { readonly path: string }
    /** The operating system could not complete the filesystem operation. */
    'user-files/unavailable': { readonly path: string }
  }
}

function cancelled(cause?: unknown): RemoteError<'gateway/cancelled'> {
  return new RemoteError('gateway/cancelled', 'user file request was cancelled', {}, { cause })
}

function decodeBase64(value: string, path: string): Uint8Array {
  if (!/^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/u.test(value)) {
    throw new RemoteError('user-files/invalid-bytes', 'byte content must be canonical base64', { path })
  }
  return new Uint8Array(Buffer.from(value, 'base64'))
}

/** Host Remote exposing user-authorized filesystem management without agent filesystem policy. */
export class UserFileRemote extends TypertRemoteService {
  /** @param ctx - Host plugin context. @param filesystem - Node filesystem owner. @param metadata - Validated browser behavior. */
  constructor(
    ctx: Context,
    readonly filesystem: UserFileFilesystem,
    private readonly configMetadata: UserFileMetadata,
  ) {
    super(ctx, 'userFiles', { namespace: 'userFiles' })
  }

  /** Return Host-owned limits, polling intervals, and initial deletion preference. */
  @Remote('metadata')
  metadata(): UserFileMetadata {
    return this.configMetadata
  }

  /** Follow an existing absolute or Session-relative path to its canonical identity. */
  @Remote('resolve')
  async resolvePath(request: UserFilePathRequest, signal: AbortSignal): Promise<UserFileResolvedPath> {
    return await this.guard(signal, async () => {
      const path = await this.absolute(request, signal)
      return await this.filesystem.resolveExisting(path)
    })
  }

  /**
   * Resolve metadata only, preserving input order and individual path failures.
   * @param request - Session and paths, capped by maxResolveBatchSize before resolution.
   * @param signal - Cancellation rejects the entire batch, including completed results.
   * @returns One metadata or error result per input, including duplicate paths.
   */
  @Remote('resolveMany')
  async resolveMany(request: UserFileResolveManyRequest, signal: AbortSignal): Promise<readonly UserFileResolveManyResult[]> {
    return await this.guard(signal, async () => {
      if (request.paths.length > this.configMetadata.maxResolveBatchSize) {
        throw new RemoteError('user-files/batch-too-large', 'too many paths in metadata request', {
          maxResolveBatchSize: this.configMetadata.maxResolveBatchSize,
        })
      }
      const results: UserFileResolveManyResult[] = []
      for (const inputPath of request.paths) {
        try {
          const value = await this.resolvePath({ sessionId: request.sessionId, path: inputPath }, signal)
          signal.throwIfAborted()
          results.push({ inputPath, ok: true, value })
        } catch (error: unknown) {
          signal.throwIfAborted()
          const failure = remoteErrorOf(error)
          if (failure === undefined || failure.code === 'gateway/cancelled') throw error
          results.push({ inputPath, ok: false, error: { code: failure.code, message: failure.message } })
        }
      }
      return results
    })
  }

  /** Read canonical LF text and its opaque guarded-write revision. */
  @Remote('readText')
  async readText(request: UserFileReadTextRequest, signal: AbortSignal): Promise<UserFileTextDocument> {
    return await this.guard(signal, async () => {
      const path = await this.absolute(request, signal)
      return await this.filesystem.readText(path, signal, request.allowLargeFile, request.maxConfirmedBytes)
    })
  }

  /**
   * Stream provisional canonical text and return a revision only after complete validation.
   * @param request Session, file and confirmation ceiling. @param signal Cancellation closes the stream.
   * @returns Ordered start, chunk and complete events; failures retain the normal user-files Remote errors.
   */
  @Remote({ mode: 'stream' })
  async *streamText(request: UserFileReadTextRequest, signal: AbortSignal): AsyncIterable<UserFileTextStreamEvent> {
    try {
      signal.throwIfAborted()
      const path = await this.absolute(request, signal)
      yield* this.filesystem.streamText(path, signal, this.configMetadata.streamChunkBytes, request.allowLargeFile, request.maxConfirmedBytes)
    } catch (error: unknown) {
      this.rethrow(signal, error)
    }
  }

  /** Read exact bounded bytes without text decoding. */
  @Remote('readBytes')
  async readBytes(request: UserFilePathRequest, signal: AbortSignal): Promise<UserFileBytesDocument> {
    return await this.guard(signal, async () => {
      const path = await this.absolute(request, signal)
      const document = await this.filesystem.readBytes(path, signal)
      return { path: document.path, dataBase64: Buffer.from(document.bytes).toString('base64'), version: document.version }
    })
  }

  /** Publish exact bytes after staging and checking the loaded revision. */
  @Remote('saveBytes')
  async saveBytes(request: UserFileSaveBytesRequest, signal: AbortSignal): Promise<UserFileSaveResult> {
    return await this.guard(signal, async () => {
      const path = await this.absolute(request, signal)
      return await this.filesystem.saveBytes(path, decodeBase64(request.dataBase64, path), request.version, signal)
    })
  }

  /** Publish text after staging and checking the loaded revision immediately before replacement. */
  @Remote('saveText')
  async saveText(request: UserFileSaveRequest, signal: AbortSignal): Promise<UserFileSaveResult> {
    return await this.guard(signal, async () => {
      const path = await this.absolute(request, signal)
      return await this.filesystem.saveText(path, request.text, request.version, signal, request.allowLargeFile, request.maxConfirmedBytes)
    })
  }

  /**
   * Atomically replace hash-checked line ranges while retaining current content outside those ranges.
   * @param request Session, file, confirmation ceiling and ordered original-coordinate ranges.
   * @param signal Cancellation before publication. @returns Published revision, bytes and complete canonical content hash.
   */
  @Remote('patchText')
  async patchText(request: UserFilePatchRequest, signal: AbortSignal): Promise<UserFilePatchResult> {
    return await this.guard(signal, async () => {
      const path = await this.absolute(request, signal)
      return await this.filesystem.patchText(path, request.ranges, signal, request.allowLargeFile, request.maxConfirmedBytes)
    })
  }

  /** @param request Session and path. @param signal Request cancellation. @returns Absolute spelling retaining symbolic links. */
  async absolute(request: UserFilePathRequest, signal: AbortSignal): Promise<string> {
    if (isAbsolute(request.path)) return resolveUserPath(request.path, process.cwd())
    return resolveUserPath(request.path, await this.cwdOf(request.sessionId, signal))
  }

  /** @param sessionId Owning Session. @param signal Request cancellation. @returns Authoritative Session cwd or the process cwd. */
  async cwdOf(sessionId: SessionId, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted()
    const live = this.ctx.sessions.get(sessionId)
    let header = live?.header
    if (header === undefined) {
      try {
        header = (await this.ctx.sessionPersistence.inspect(sessionId, signal)).meta
      } catch (error: unknown) {
        if (signal.aborted) throw cancelled(error)
        if (error instanceof SessionPersistenceNotFoundError) {
          throw new RemoteError('user-files/not-found', `session "${sessionId}" was not found`, {
            sessionId,
            path: '',
          }, { cause: error })
        }
        throw new UserFileFilesystemError(
          'unavailable', '', `session "${sessionId}" could not be inspected`, { cause: error },
        )
      }
    }
    return header.cwd ?? process.cwd()
  }

  private async guard<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    try {
      signal.throwIfAborted()
      return await operation()
    } catch (error: unknown) {
      this.rethrow(signal, error)
    }
  }

  private rethrow(signal: AbortSignal, error: unknown): never {
    if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw cancelled(error)
    if (error instanceof UserFileConfirmationRequiredError) {
      throw new RemoteError('user-files/confirmation-required', error.message, {
        path: error.path, sizeBytes: error.sizeBytes, thresholdBytes: error.thresholdBytes,
      }, { cause: error })
    }
    if (!(error instanceof UserFileFilesystemError)) throw error
    if (error.code === 'invalid-request') {
      throw new RemoteError('gateway/bad-request', error.message, {}, { cause: error })
    }
    const details = error.code === 'too-large'
      ? {
          path: error.path,
          maxTextReadBytes: this.configMetadata.maxTextReadBytes,
          maxByteReadBytes: this.configMetadata.maxByteReadBytes,
        }
      : { path: error.path }
    throw new RemoteError(`user-files/${error.code}` as keyof import('@deepseek-ai/dsh-typert-protocol').RemoteErrorDetailsMap, error.message, details, { cause: error })
  }
}
