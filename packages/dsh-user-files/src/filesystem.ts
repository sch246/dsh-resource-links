import { createHash, randomBytes } from 'node:crypto'
import type { Stats } from 'node:fs'
import {
  open, realpath, rename, rm, stat,
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path'
import { lookup as lookupMediaType } from 'mime-types'
import type {
  UserFileEntryKind, UserFileResolvedPath, UserFileRevision,
  UserFileSaveResult, UserFileTextDocument,
} from './types.ts'

/** Stable user-filesystem failures translated by the Host Remote. */
export type UserFileFilesystemErrorCode =
  | 'invalid-path'
  | 'not-found'
  | 'not-directory'
  | 'not-file'
  | 'not-text'
  | 'too-large'
  | 'already-exists'
  | 'stale-version'
  | 'unavailable'

/** Filesystem failure with a stable category and addressed path. */
export class UserFileFilesystemError extends Error {
  /** @param code - Stable failure category. @param path - Normalized addressed path. @param message - Diagnostic text. @param options - Optional underlying cause. */
  constructor(
    readonly code: UserFileFilesystemErrorCode,
    readonly path: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'UserFileFilesystemError'
  }
}

interface ExactStat {
  readonly dev: number
  readonly ino: number
  readonly size: number
  readonly mode: number
  readonly mtimeMs: number
  readonly ctimeMs: number
}

interface RevisionPayload {
  readonly format: 1
  readonly path: string
  readonly stat: ExactStat
  readonly sha256: string
  readonly eol: 'none' | 'lf' | 'crlf' | 'cr' | 'mixed'
  readonly mixedEolPattern?: string
}

interface ReadBytesResult {
  readonly path: string
  readonly bytes: Uint8Array
  readonly payload: RevisionPayload
}

/** Exact bytes returned inside the Host before JSON transport encoding. */
export interface UserFileByteContent {
  readonly path: string
  readonly bytes: Uint8Array
  readonly version: UserFileRevision
}

/** @param path Absolute user path. @returns Normalized absolute spelling without following links. */
export function normalizedAbsolute(path: string): string {
  if (path.trim() === '' || !isAbsolute(path)) {
    throw new UserFileFilesystemError('invalid-path', path, 'user-files requires an absolute path')
  }
  return normalize(resolve(path))
}

function exactStat(value: Stats): ExactStat {
  return {
    dev: value.dev,
    ino: value.ino,
    size: value.size,
    mode: value.mode,
    mtimeMs: value.mtimeMs,
    ctimeMs: value.ctimeMs,
  }
}

function sameStat(left: ExactStat, right: ExactStat): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.mode === right.mode && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function encodeRevision(payload: RevisionPayload): UserFileRevision {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

function parseRevision(value: UserFileRevision, path: string): RevisionPayload {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object')
    const candidate = parsed as Partial<RevisionPayload>
    const revisionStat = candidate.stat as Partial<ExactStat> | null | undefined
    const statFields = revisionStat === null || revisionStat === undefined
      ? []
      : [revisionStat.dev, revisionStat.ino, revisionStat.size, revisionStat.mode, revisionStat.mtimeMs, revisionStat.ctimeMs]
    const validEol = candidate.eol === 'none' || candidate.eol === 'lf' || candidate.eol === 'crlf'
      || candidate.eol === 'cr' || candidate.eol === 'mixed'
    if (candidate.format !== 1 || typeof candidate.path !== 'string'
      || !/^[a-f\d]{64}$/u.test(candidate.sha256 ?? '')
      || statFields.length !== 6 || !statFields.every(field => typeof field === 'number' && Number.isFinite(field))
      || !validEol
      || (candidate.eol === 'mixed' && (typeof candidate.mixedEolPattern !== 'string'
        || !/^[wrl]+$/u.test(candidate.mixedEolPattern)))) {
      throw new Error('missing revision fields')
    }
    return candidate as RevisionPayload
  } catch (error: unknown) {
    throw new UserFileFilesystemError(
      'stale-version', path, `filesystem revision for "${path}" is invalid`, { cause: error },
    )
  }
}

function eolMetadata(text: string): Pick<RevisionPayload, 'eol' | 'mixedEolPattern'> {
  const endings = text.match(/\r\n|\r|\n/g) ?? []
  if (endings.length === 0) return { eol: 'none' }
  const symbols = endings.map(value => value === '\r\n' ? 'w' : value === '\r' ? 'r' : 'l')
  const first = symbols[0]
  if (symbols.every(value => value === first)) {
    return { eol: first === 'w' ? 'crlf' : first === 'r' ? 'cr' : 'lf' }
  }
  return { eol: 'mixed', mixedEolPattern: symbols.join('') }
}

function canonicalText(text: string): string {
  return text.replace(/\r\n|\r/g, '\n')
}

function restoreEol(text: string, revision: RevisionPayload): string {
  if (revision.eol === 'none' || revision.eol === 'lf') return text
  if (revision.eol === 'crlf') return text.replaceAll('\n', '\r\n')
  if (revision.eol === 'cr') return text.replaceAll('\n', '\r')
  const pattern = revision.mixedEolPattern ?? ''
  let index = 0
  return text.replaceAll('\n', () => {
    const symbol = pattern[index++] ?? pattern.at(-1) ?? 'l'
    return symbol === 'w' ? '\r\n' : symbol === 'r' ? '\r' : '\n'
  })
}

function mapNodeError(error: unknown, path: string): UserFileFilesystemError {
  if (error instanceof UserFileFilesystemError) return error
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : ''
  if (code === 'ENOENT') return new UserFileFilesystemError('not-found', path, `path "${path}" was not found`, { cause: error })
  if (code === 'ENOTDIR') return new UserFileFilesystemError('not-directory', path, `path "${path}" is not a directory`, { cause: error })
  if (code === 'EISDIR') return new UserFileFilesystemError('not-file', path, `path "${path}" is not a regular file`, { cause: error })
  if (code === 'EEXIST') return new UserFileFilesystemError('already-exists', path, `path "${path}" already exists`, { cause: error })
  return new UserFileFilesystemError('unavailable', path, `filesystem operation failed for "${path}"`, { cause: error })
}

function entryKind(value: Stats): UserFileEntryKind {
  if (value.isDirectory()) return 'directory'
  if (value.isFile()) return 'file'
  return 'other'
}

function mediaTypeOf(path: string, kind: UserFileEntryKind): string | undefined {
  if (kind !== 'file') return undefined
  const value = lookupMediaType(path)
  return value === false ? undefined : value
}

function resolvedMetadata(path: string, info: Stats): UserFileResolvedPath {
  const kind = entryKind(info)
  const mediaType = mediaTypeOf(path, kind)
  return {
    path,
    name: basename(path) || path,
    kind,
    ...(kind === 'file' ? { size: info.size, modifiedAtMs: info.mtimeMs } : {}),
    ...(mediaType === undefined ? {} : { mediaType }),
  }
}

/** Node filesystem owner for authenticated browser file-management operations. */
export class UserFileFilesystem {
  readonly #maxTextReadBytes: number
  readonly #maxByteReadBytes: number
  #mutationTail: Promise<void> = Promise.resolve()

  /** @param maxTextReadBytes Inclusive text bound. @param maxByteReadBytes Inclusive byte bound. */
  constructor(maxTextReadBytes: number, maxByteReadBytes: number) {
    this.#maxTextReadBytes = maxTextReadBytes
    this.#maxByteReadBytes = maxByteReadBytes
  }

  /** Follow one existing path and return metadata without reading file content. */
  async resolveExisting(path: string): Promise<UserFileResolvedPath> {
    const input = normalizedAbsolute(path)
    try {
      const canonical = await realpath(input)
      const info = await stat(canonical)
      return resolvedMetadata(canonical, info)
    } catch (error: unknown) {
      throw mapNodeError(error, input)
    }
  }

  /** Load a complete UTF-8 regular file as canonical LF text and an exact opaque revision. */
  async readText(path: string, signal: AbortSignal): Promise<UserFileTextDocument> {
    const result = await this.#readFileBytes(path, signal, this.#maxTextReadBytes)
    let decoded: string
    if (result.bytes.includes(0)) {
      throw new UserFileFilesystemError('not-text', result.path, `path "${result.path}" contains NUL bytes`)
    }
    try {
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(result.bytes)
    } catch (error: unknown) {
      throw new UserFileFilesystemError('not-text', result.path, `path "${result.path}" is not UTF-8 text`, { cause: error })
    }
    const metadata = eolMetadata(decoded)
    const payload: RevisionPayload = { ...result.payload, ...metadata }
    return { path: result.path, text: canonicalText(decoded), version: encodeRevision(payload) }
  }

  /** Read complete bounded bytes without applying text validation or normalization. */
  async readBytes(path: string, signal: AbortSignal): Promise<UserFileByteContent> {
    const result = await this.#readFileBytes(path, signal, this.#maxByteReadBytes)
    return { path: result.path, bytes: new Uint8Array(result.bytes), version: encodeRevision(result.payload) }
  }

  /** Stage and atomically replace text after the last exact revision check. */
  async saveText(
    path: string,
    text: string,
    version: UserFileRevision,
    signal: AbortSignal,
  ): Promise<UserFileSaveResult> {
    return await this.#publish(
      path,
      version,
      signal,
      this.#maxTextReadBytes,
      expected => new TextEncoder().encode(restoreEol(text, expected)),
      saved => {
        const savedText = new TextDecoder('utf-8', { fatal: true }).decode(saved.bytes)
        return { ...saved.payload, ...eolMetadata(savedText) }
      },
    )
  }

  /** Stage and atomically replace exact bytes after the last revision check. */
  async saveBytes(
    path: string,
    bytes: Uint8Array,
    version: UserFileRevision,
    signal: AbortSignal,
  ): Promise<UserFileSaveResult> {
    return await this.#publish(
      path,
      version,
      signal,
      this.#maxByteReadBytes,
      () => bytes,
      saved => saved.payload,
    )
  }

  async #publish(
    path: string,
    version: UserFileRevision,
    signal: AbortSignal,
    maxBytes: number,
    bytesOf: (expected: RevisionPayload) => Uint8Array,
    revisionOf: (saved: ReadBytesResult) => RevisionPayload,
  ): Promise<UserFileSaveResult> {
    return await this.mutate(signal, async () => {
      const canonical = (await this.resolveExisting(path)).path
      signal.throwIfAborted()
      const expected = parseRevision(version, canonical)
      if (expected.path !== canonical) {
        throw new UserFileFilesystemError('stale-version', canonical, `filesystem revision belongs to "${expected.path}"`)
      }
      const bytes = bytesOf(expected)
      if (bytes.byteLength > maxBytes) {
        throw new UserFileFilesystemError('too-large', canonical, `path "${canonical}" exceeds the configured resource limit`)
      }
      const stage = join(dirname(canonical), `.${basename(canonical)}.dsh-stage-${randomBytes(12).toString('hex')}`)
      let staged = false
      try {
        const handle = await open(stage, 'wx', expected.stat.mode & 0o777)
        staged = true
        try {
          await handle.chmod(expected.stat.mode & 0o7777)
          await handle.writeFile(bytes)
          await handle.sync()
        } finally {
          await handle.close()
        }
        const current = await this.#readFileBytes(canonical, signal, maxBytes)
        if (!sameStat(current.payload.stat, expected.stat) || current.payload.sha256 !== expected.sha256) {
          throw new UserFileFilesystemError('stale-version', canonical, `path "${canonical}" changed after it was loaded`)
        }
        signal.throwIfAborted()
        await rename(stage, canonical)
        staged = false
        // Publication is terminal: cancellation after rename must not report that the save did not happen.
        const saved = await this.#readFileBytes(canonical, new AbortController().signal, maxBytes)
        return { version: encodeRevision(revisionOf(saved)) }
      } catch (error: unknown) {
        throw mapNodeError(error, canonical)
      } finally {
        if (staged) {
          try { await rm(stage, { force: true }) } catch { /* A failed stage cleanup cannot replace the primary failure. */ }
        }
      }
    })
  }

  async #readFileBytes(path: string, signal: AbortSignal, maxBytes: number): Promise<ReadBytesResult> {
    signal.throwIfAborted()
    const input = normalizedAbsolute(path)
    try {
      const canonical = await realpath(input)
      const handle = await open(canonical, 'r')
      try {
        const beforeValue = await handle.stat()
        if (!beforeValue.isFile()) {
          throw new UserFileFilesystemError('not-file', canonical, `path "${canonical}" is not a regular file`)
        }
        if (beforeValue.size > maxBytes) {
          throw new UserFileFilesystemError('too-large', canonical, `path "${canonical}" exceeds the configured resource limit`)
        }
        signal.throwIfAborted()
        const bytes = await handle.readFile()
        signal.throwIfAborted()
        const afterValue = await handle.stat()
        const before = exactStat(beforeValue)
        const after = exactStat(afterValue)
        if (!sameStat(before, after) || bytes.byteLength !== before.size) {
          throw new UserFileFilesystemError('stale-version', canonical, `path "${canonical}" changed while it was read`)
        }
        return {
          path: canonical,
          bytes,
          payload: { format: 1, path: canonical, stat: before, sha256: sha256(bytes), eol: 'none' },
        }
      } finally {
        await handle.close()
      }
    } catch (error: unknown) {
      throw mapNodeError(error, input)
    }
  }

  /**
   * Serialize disk publications and manager mutations, checking cancellation before execution.
   * @param signal Request cancellation; completion after publication remains successful.
   * @param operation One non-nested filesystem mutation using this provider.
   * @returns The committed operation result.
   */
  async mutate<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    const predecessor = this.#mutationTail
    let release = (): void => {}
    const ticket = new Promise<void>(resolveTicket => { release = resolveTicket })
    this.#mutationTail = predecessor.then(() => ticket)
    await predecessor
    try {
      signal.throwIfAborted()
      return await operation()
    } finally {
      release()
    }
  }

}

/** Resolve a Session-relative user path without imposing workspace containment. */
export function resolveUserPath(path: string, cwd: string): string {
  if (path.trim() === '') throw new UserFileFilesystemError('invalid-path', path, 'path must not be empty')
  return isAbsolute(path) ? normalize(resolve(path)) : normalize(resolve(cwd, path.split('/').join(sep)))
}
