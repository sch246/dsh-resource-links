import { createHash, randomBytes } from 'node:crypto'
import { constants as bufferConstants } from 'node:buffer'
import type { FileHandle } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import {
  open, realpath, rename, rm, stat,
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path'
import { lookup as lookupMediaType } from 'mime-types'
import { TextDeltaBackend, NativeDiffError } from './hdiffpatch.ts'
import { defaultDeltaPolicy } from './delta-policy.ts'
import { prepareTextPatches, validateTextPatchRanges, TextPatchError } from './text-patch.ts'
import type {
  UserFileTextReadPlan, UserFileTextChunk,
  UserFileEntryKind, UserFileResolvedPath, UserFileRevision,
  UserFileSaveResult, UserFileTextDocument, UserFileTextStreamEvent, UserFileTextPatch, UserFilePatchResult, UserFileDeltaRequest, UserFileDeltaResult, UserFileDeltaPolicy,
} from './types.ts'

/** Default raw chunk bytes for Config and standalone filesystem consumers. */
export const defaultTextReadChunkBytes = 1048576

/** Maximum raw chunk fitting both a Buffer and its base64 string. */
export const maxTextReadChunkBytes = Math.min(bufferConstants.MAX_LENGTH, Math.floor(bufferConstants.MAX_STRING_LENGTH / 4) * 3)

/** Stable user-filesystem failures translated by the Host Remote. */
export type UserFileFilesystemErrorCode =
  | 'invalid-path'
  | 'invalid-request'
  | 'not-found'
  | 'not-directory'
  | 'not-file'
  | 'not-text'
  | 'too-large'
  | 'confirmation-required'
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

/** A text operation needs explicit user confirmation before exceeding its size threshold. */
export class UserFileConfirmationRequiredError extends UserFileFilesystemError {
  /** @param path Addressed file. @param sizeBytes Existing file bytes. @param thresholdBytes Inclusive automatic-access threshold. */
  constructor(path: string, readonly sizeBytes: number, readonly thresholdBytes: number) {
    super('confirmation-required', path, `path "${path}" is ${sizeBytes} bytes; confirm access above ${thresholdBytes} bytes`)
  }
}

type FileSizePolicy = { readonly kind: 'text'; readonly thresholdBytes: number } | { readonly kind: 'bytes' }

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

function textReadVersion(path: string, info: ExactStat): string {
  return sha256(Buffer.from(JSON.stringify({ path, stat: info })))
}

function validateReadVersion(value: string, path: string): void {
  if (!/^[a-f\d]{64}$/u.test(value)) {
    throw new UserFileFilesystemError('invalid-request', path, 'readVersion must be a lowercase SHA-256')
  }
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

function eolPattern(text: string): string {
  return (text.match(/\r\n|\r|\n/g) ?? []).map(value => value === '\r\n' ? 'w' : value === '\r' ? 'r' : 'l').join('')
}

function eolMetadataOfPattern(pattern: string): Pick<RevisionPayload, 'eol' | 'mixedEolPattern'> {
  if (pattern.length === 0) return { eol: 'none' }
  const first = pattern[0]
  for (const symbol of pattern) {
    if (symbol !== first) return { eol: 'mixed', mixedEolPattern: pattern }
  }
  return { eol: first === 'w' ? 'crlf' : first === 'r' ? 'cr' : 'lf' }
}

function eolMetadata(text: string): Pick<RevisionPayload, 'eol' | 'mixedEolPattern'> {
  return eolMetadataOfPattern(eolPattern(text))
}

function canonicalText(text: string): string {
  return text.replace(/\r\n|\r/g, '\n')
}

function decodeText(bytes: Uint8Array, path: string): string {
  if (bytes.includes(0)) throw new UserFileFilesystemError('not-text', path, `path "${path}" contains NUL bytes`)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error: unknown) {
    throw new UserFileFilesystemError('not-text', path, `path "${path}" is not UTF-8 text`, { cause: error })
  }
}

function lineTokens(text: string): string[] {
  return text.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) ?? []
}

function lineEnding(line: string | undefined): string | undefined {
  return line?.match(/\r\n$|\r$|\n$/u)?.[0]
}

function replacementLines(lines: readonly string[], range: UserFileTextPatch): string {
  const old = lines.slice(range.startLine, range.startLine + range.lineCount)
  const replacement = lineTokens(range.replacement)
  let prefix = 0
  while (prefix < old.length && prefix < replacement.length && canonicalText(old[prefix]!) === replacement[prefix]) prefix++
  let suffix = 0
  while (suffix < old.length - prefix && suffix < replacement.length - prefix
    && canonicalText(old[old.length - suffix - 1]!) === replacement[replacement.length - suffix - 1]) suffix++
  const fallback = old.map(lineEnding).findLast(ending => ending !== undefined)
    ?? lineEnding(lines[range.startLine - 1]) ?? lineEnding(lines[range.startLine + range.lineCount]) ?? '\n'
  return replacement.map((line, index) => {
    if (index < prefix) return old[index]!
    if (index >= replacement.length - suffix) return old[old.length - (replacement.length - index)]!
    return line.endsWith('\n') ? line.slice(0, -1) + (lineEnding(old[index]) ?? fallback) : line
  }).join('')
}

async function patchedBytes(current: ReadBytesResult, ranges: readonly UserFileTextPatch[]): Promise<Uint8Array> {
  const lines = lineTokens(decodeText(current.bytes, current.path))
  await validateTextPatchRanges(lines.map(canonicalText), ranges, async text => sha256(Buffer.from(text)))
  const output: string[] = []
  let position = 0
  for (const range of ranges) {
    output.push(lines.slice(position, range.startLine).join(''), replacementLines(lines, range))
    position = range.startLine + range.lineCount
  }
  output.push(lines.slice(position).join(''))
  const bom = current.bytes[0] === 0xef && current.bytes[1] === 0xbb && current.bytes[2] === 0xbf ? '\uFEFF' : ''
  return Buffer.from(bom + output.join(''))
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
  if (error instanceof NativeDiffError) return new UserFileFilesystemError('unavailable', path, error.message, { cause: error })
  if (error instanceof TextPatchError) return new UserFileFilesystemError(error.code, path, error.message, { cause: error })
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
  readonly #textReadChunkBytes: number
  #mutationTail: Promise<void> = Promise.resolve()
  readonly #deltaPolicy: UserFileDeltaPolicy
  readonly #deltaBackend: TextDeltaBackend
  readonly #baselines = new Map<string, { text: string; payload: RevisionPayload; metadata: UserFilePatchResult; cost: number }>()
  #baselineBytes = 0
  #activeDeltas = 0
  #disposed = false

  /** @param maxTextReadBytes Inclusive text confirmation threshold. @param maxByteReadBytes Inclusive byte bound. @param deltaPolicy Validated delta and baseline budgets. @param textReadChunkBytes Raw bytes per range request. */
  constructor(maxTextReadBytes: number, maxByteReadBytes: number, deltaPolicy: UserFileDeltaPolicy = defaultDeltaPolicy, textReadChunkBytes = defaultTextReadChunkBytes) {
    if (!Number.isSafeInteger(textReadChunkBytes) || textReadChunkBytes <= 0 || textReadChunkBytes > maxTextReadChunkBytes) {
      throw new UserFileFilesystemError('invalid-request', '', 'textReadChunkBytes exceeds the positive Buffer/base64 allocation range')
    }
    this.#textReadChunkBytes = textReadChunkBytes
    this.#maxTextReadBytes = maxTextReadBytes
    this.#maxByteReadBytes = maxByteReadBytes
    this.#deltaPolicy = { ...deltaPolicy }
    this.#deltaBackend = new TextDeltaBackend(this.#deltaPolicy)
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

  /**
   * Load complete UTF-8 text and its exact revision; unconfirmed oversized files fail after stat and before content reads.
   * @param path File to load. @param signal Request cancellation. @param allowLargeFile Explicit confirmation for this read.
   * @param maxConfirmedBytes Optional inclusive ceiling for existing disk content; must be a positive safe integer.
   * @returns Canonical LF text, exact disk bytes and an opaque guarded-save revision.
   */
  async readText(path: string, signal: AbortSignal, allowLargeFile = false, maxConfirmedBytes?: number): Promise<UserFileTextDocument> {
    const result = await this.#readFileBytes(path, signal, this.#textPolicy(path, allowLargeFile, maxConfirmedBytes))
    const decoded = decodeText(result.bytes, result.path)
    const metadata = eolMetadata(decoded)
    const payload: RevisionPayload = { ...result.payload, ...metadata }
    const text = canonicalText(decoded)
    const version = !this.#disposed && text.length * 2 <= this.#deltaPolicy.baselineBytes
      ? this.#remember(text, payload).version : encodeRevision(payload)
    return { path: result.path, text, version, sizeBytes: result.payload.stat.size }
  }

  /**
   * Prepare independently retryable text chunks using metadata only.
   * @param path File to load. @param signal Request cancellation. @param allowLargeFile Explicit confirmation.
   * @param maxConfirmedBytes Inclusive confirmed byte ceiling. @returns Canonical path, exact size, chunk bytes and stat fingerprint.
   */
  async prepareTextRead(path: string, signal: AbortSignal, allowLargeFile = false, maxConfirmedBytes?: number): Promise<UserFileTextReadPlan> {
    signal.throwIfAborted()
    const policy = this.#textPolicy(path, allowLargeFile, maxConfirmedBytes)
    const input = normalizedAbsolute(path)
    try {
      const canonical = await realpath(input)
      const info = await stat(canonical)
      signal.throwIfAborted()
      if (!info.isFile()) throw new UserFileFilesystemError('not-file', canonical, `path "${canonical}" is not a regular file`)
      this.#checkSize(canonical, info.size, policy)
      return { path: canonical, sizeBytes: info.size, chunkBytes: this.#textReadChunkBytes, readVersion: textReadVersion(canonical, exactStat(info)) }
    } catch (error: unknown) {
      signal.throwIfAborted()
      throw mapNodeError(error, input)
    }
  }

  /**
   * Read one independently retryable raw chunk while checking the prepared file identity before and after content access.
   * @param path Prepared file. @param readVersion Metadata fingerprint. @param offset Aligned safe-integer raw byte offset.
   * @param signal Cancellation closes the file. @param allowLargeFile Explicit confirmation. @param maxConfirmedBytes Inclusive byte ceiling.
   * @returns Exact raw bytes encoded as base64 and their lowercase SHA-256.
   */
  async readTextChunk(path: string, readVersion: string, offset: number, signal: AbortSignal, allowLargeFile = false, maxConfirmedBytes?: number): Promise<UserFileTextChunk> {
    const policy = this.#textPolicy(path, allowLargeFile, maxConfirmedBytes)
    validateReadVersion(readVersion, path)
    if (!Number.isSafeInteger(offset) || offset < 0 || offset % this.#textReadChunkBytes !== 0) {
      throw new UserFileFilesystemError('invalid-request', path, 'offset must be a nonnegative safe integer aligned to textReadChunkBytes')
    }
    return await this.#withReadFile(path, signal, policy, readVersion, async (handle, canonical, before) => {
      if (offset >= before.size) throw new UserFileFilesystemError('invalid-request', canonical, 'offset must be below the prepared file size')
      const bytes = Buffer.alloc(Math.min(this.#textReadChunkBytes, before.size - offset))
      let received = 0
      while (received < bytes.length) {
        signal.throwIfAborted()
        const result = await handle.read(bytes, received, bytes.length - received, offset + received)
        signal.throwIfAborted()
        if (result.bytesRead === 0) {
          throw new UserFileFilesystemError('stale-version', canonical, `path "${canonical}" ended before its recorded chunk size`)
        }
        received += result.bytesRead
      }
      return { offset, dataBase64: bytes.toString('base64'), sha256: sha256(bytes) }
    })
  }

  /**
   * Validate complete UTF-8 content and establish the canonical baseline without returning the document.
   * @param path Prepared file. @param readVersion Metadata fingerprint. @param signal Cancellation closes the file.
   * @param allowLargeFile Explicit confirmation. @param maxConfirmedBytes Inclusive confirmed byte ceiling.
   * @returns Guarded-save revision, exact bytes and complete canonical LF hash, excluding a UTF-8 BOM.
   */
  async finishTextRead(path: string, readVersion: string, signal: AbortSignal, allowLargeFile = false, maxConfirmedBytes?: number): Promise<UserFilePatchResult> {
    const policy = this.#textPolicy(path, allowLargeFile, maxConfirmedBytes)
    validateReadVersion(readVersion, path)
    const result = await this.#readFileBytes(path, signal, policy, readVersion)
    const decoded = decodeText(result.bytes, result.path)
    return this.#remember(canonicalText(decoded), { ...result.payload, ...eolMetadata(decoded) })
  }

  /**
   * Stream canonical LF text; only bounded cache candidates are retained, and completion validates raw bytes, EOLs and file identity.
   * @param path File to load. @param signal Cancellation closes the file and prevents completion.
   * @param streamChunkBytes Maximum raw bytes per read, as a positive safe integer.
   * @param allowLargeFile Explicit confirmation. @param maxConfirmedBytes Optional inclusive existing-file ceiling.
   * @returns Start metadata, provisional text chunks with cumulative raw bytes, and the validated revision.
   */
  async *streamText(
    path: string, signal: AbortSignal, streamChunkBytes: number, allowLargeFile = false, maxConfirmedBytes?: number,
  ): AsyncIterable<UserFileTextStreamEvent> {
    signal.throwIfAborted()
    const policy = this.#textPolicy(path, allowLargeFile, maxConfirmedBytes)
    if (!Number.isSafeInteger(streamChunkBytes) || streamChunkBytes <= 0) {
      throw new UserFileFilesystemError('invalid-request', path, 'streamChunkBytes must be a positive safe integer')
    }
    const input = normalizedAbsolute(path)
    try {
      const canonical = await realpath(input)
      const handle = await open(canonical, 'r')
      let closing: Promise<void> | undefined
      const close = (): Promise<void> => closing ??= handle.close()
      const onAbort = (): void => {
        void close().catch(() => { /* The finally block awaits and reports this close failure. */ })
      }
      signal.addEventListener('abort', onAbort, { once: true })
      try {
        signal.throwIfAborted()
        const info = await handle.stat()
        if (!info.isFile()) throw new UserFileFilesystemError('not-file', canonical, `path "${canonical}" is not a regular file`)
        this.#checkSize(canonical, info.size, policy)
        const before = exactStat(info)
        signal.throwIfAborted()
        let candidate: string[] | undefined = !this.#disposed && before.size <= this.#deltaPolicy.baselineBytes / 2 ? [] : undefined
        let candidateBytes = 0
        yield { kind: 'start', path: canonical, sizeBytes: before.size }
        signal.throwIfAborted()
        const buffer = Buffer.alloc(Math.min(streamChunkBytes, before.size))
        const hash = createHash('sha256')
        const decoder = new TextDecoder('utf-8', { fatal: true })
        const patterns: string[] = []
        let pendingCr = ''
        let bytesRead = 0
        const decode = (bytes: Uint8Array | undefined, final: boolean): string => {
          let decoded: string
          try {
            decoded = pendingCr + decoder.decode(bytes, { stream: !final })
          } catch (error: unknown) {
            throw new UserFileFilesystemError('not-text', canonical, `path "${canonical}" is not UTF-8 text`, { cause: error })
          }
          pendingCr = !final && decoded.endsWith('\r') ? '\r' : ''
          if (pendingCr) decoded = decoded.slice(0, -1)
          const pattern = eolPattern(decoded)
          if (pattern) patterns.push(pattern)
          const text = canonicalText(decoded)
          if (candidate !== undefined) {
            candidateBytes += text.length * 2
            if (!this.#disposed && candidateBytes <= this.#deltaPolicy.baselineBytes) candidate.push(text)
            else candidate = undefined
          }
          return text
        }
        while (bytesRead < before.size) {
          signal.throwIfAborted()
          const result = await handle.read(buffer, 0, Math.min(buffer.length, before.size - bytesRead), bytesRead)
          signal.throwIfAborted()
          if (result.bytesRead === 0) {
            throw new UserFileFilesystemError('stale-version', canonical, `path "${canonical}" ended before its recorded size`)
          }
          const bytes = buffer.subarray(0, result.bytesRead)
          if (bytes.includes(0)) throw new UserFileFilesystemError('not-text', canonical, `path "${canonical}" contains NUL bytes`)
          hash.update(bytes)
          bytesRead += result.bytesRead
          yield { kind: 'chunk', text: decode(bytes, false), bytesRead }
        }
        signal.throwIfAborted()
        const tail = decode(undefined, true)
        if (tail) yield { kind: 'chunk', text: tail, bytesRead }
        signal.throwIfAborted()
        const after = exactStat(await handle.stat())
        const current = exactStat(await stat(canonical))
        if (!sameStat(before, after) || !sameStat(before, current)) {
          throw new UserFileFilesystemError('stale-version', canonical, `path "${canonical}" changed while it was read`)
        }
        await close()
        signal.throwIfAborted()
        const payload: RevisionPayload = {
          format: 1, path: canonical, stat: before, sha256: hash.digest('hex'), ...eolMetadataOfPattern(patterns.join('')),
        }
        const version = candidate === undefined ? encodeRevision(payload) : this.#remember(candidate.join(''), payload).version
        yield { kind: 'complete', version, sizeBytes: bytesRead }
      } finally {
        signal.removeEventListener('abort', onAbort)
        await close()
      }
    } catch (error: unknown) {
      signal.throwIfAborted()
      throw mapNodeError(error, input)
    }
  }

  /** Read complete bounded bytes without applying text validation or normalization. */
  async readBytes(path: string, signal: AbortSignal): Promise<UserFileByteContent> {
    const result = await this.#readFileBytes(path, signal, { kind: 'bytes' })
    return { path: result.path, bytes: new Uint8Array(result.bytes), version: encodeRevision(result.payload) }
  }

  /**
   * Atomically replace text after the last exact revision check; existing disk content requires confirmation above the threshold; local replacement text has no size limit.
   * @param path File to replace. @param text Canonical LF text. @param version Loaded revision. @param signal Request cancellation.
   * @param allowLargeFile Explicit confirmation for this save.
   * @param maxConfirmedBytes Optional inclusive ceiling for existing disk content; must be a positive safe integer.
   * @returns The published revision and exact disk byte count.
   */
  async saveText(
    path: string,
    text: string,
    version: UserFileRevision,
    signal: AbortSignal,
    allowLargeFile = false,
    maxConfirmedBytes?: number,
  ): Promise<UserFileSaveResult> {
    return await this.#publish(
      path,
      version,
      signal,
      this.#textPolicy(path, allowLargeFile, maxConfirmedBytes),
      expected => new TextEncoder().encode(restoreEol(text, expected)),
      saved => {
        const savedText = new TextDecoder('utf-8', { fatal: true }).decode(saved.bytes)
        return { ...saved.payload, ...eolMetadata(savedText) }
      },
    )
  }

  /**
   * Check all original-coordinate ranges against one current snapshot, then atomically publish their replacements.
   * @param path File to patch. @param ranges Ordered disjoint LF-token ranges with mandatory old-content hashes.
   * @param signal Request cancellation. @param allowLargeFile Explicit existing-content confirmation.
   * @param maxConfirmedBytes Optional inclusive positive safe-integer existing-file ceiling.
   * @returns Published revision, exact bytes and SHA-256 of the actual complete canonical output.
   */
  async patchText(
    path: string, ranges: readonly UserFileTextPatch[], signal: AbortSignal, allowLargeFile = false, maxConfirmedBytes?: number,
  ): Promise<UserFilePatchResult> {
    const policy = this.#textPolicy(path, allowLargeFile, maxConfirmedBytes)
    let patches: readonly UserFileTextPatch[]
    try { patches = prepareTextPatches(ranges) } catch (error: unknown) { throw mapNodeError(error, path) }
    return await this.mutate(signal, async () => {
      const initial = await this.#readFileBytes(path, signal, policy)
      let saved = initial
      if (patches.length > 0) {
        let bytes: Uint8Array
        try { bytes = await patchedBytes(initial, patches) } catch (error: unknown) { throw mapNodeError(error, path) }
        saved = await this.#replace(initial.path, initial.payload, bytes, signal, policy)
      }
      const text = decodeText(saved.bytes, saved.path)
      return this.#remember(canonicalText(text), { ...saved.payload, ...eolMetadata(text) })
    })
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
      { kind: 'bytes' },
      () => bytes,
      saved => saved.payload,
    )
  }

  async #publish(
    path: string,
    version: UserFileRevision,
    signal: AbortSignal,
    policy: FileSizePolicy,
    bytesOf: (expected: RevisionPayload) => Uint8Array,
    revisionOf: (saved: ReadBytesResult) => RevisionPayload,
  ): Promise<UserFileSaveResult> {
    return await this.mutate(signal, async () => {
      const metadata = await this.resolveExisting(path)
      const canonical = metadata.path
      if (metadata.kind !== 'file') {
        throw new UserFileFilesystemError('not-file', canonical, `path "${canonical}" is not a regular file`)
      }
      this.#checkSize(canonical, metadata.size!, policy)
      signal.throwIfAborted()
      const expected = parseRevision(version, canonical)
      if (expected.path !== canonical) {
        throw new UserFileFilesystemError('stale-version', canonical, `filesystem revision belongs to "${expected.path}"`)
      }
      const bytes = bytesOf(expected)
      if (policy.kind === 'bytes') this.#checkSize(canonical, bytes.byteLength, policy)
      const saved = await this.#replace(canonical, expected, bytes, signal, policy)
      return { version: encodeRevision(revisionOf(saved)), sizeBytes: saved.payload.stat.size }
    })
  }

  async #replace(
    canonical: string, expected: RevisionPayload, bytes: Uint8Array, signal: AbortSignal, policy: FileSizePolicy,
  ): Promise<ReadBytesResult> {
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
      const current = await this.#readFileBytes(canonical, signal, policy)
      if (!sameStat(current.payload.stat, expected.stat) || current.payload.sha256 !== expected.sha256) {
        throw new UserFileFilesystemError('stale-version', canonical, `path "${canonical}" changed after it was loaded`)
      }
      signal.throwIfAborted()
      await rename(stage, canonical)
      staged = false
      // Publication is terminal: cancellation after rename must not report that the save did not happen.
      // Published text combines supplied replacements with already validated content and needs no additional confirmation.
      const publishedPolicy: FileSizePolicy = policy.kind === 'text' ? { kind: 'text', thresholdBytes: Infinity } : policy
      const saved = await this.#readFileBytes(canonical, new AbortController().signal, publishedPolicy)
      return saved
    } catch (error: unknown) {
      throw mapNodeError(error, canonical)
    } finally {
      if (staged) {
        try { await rm(stage, { force: true }) } catch { /* A failed stage cleanup cannot replace the primary failure. */ }
      }
    }
  }

  /** Clear retained baselines, prevent late cache publication, and await native job termination and cleanup. */
  dispose(): Promise<void> {
    this.#disposed = true
    this.#baselines.clear()
    this.#baselineBytes = 0
    return this.#deltaBackend.dispose()
  }

  #remember(text: string, payload: RevisionPayload): UserFilePatchResult {
    const metadata = { version: encodeRevision(payload), sizeBytes: payload.stat.size, canonicalHash: sha256(Buffer.from(text)) }
    const cost = text.length * 2
    if (this.#disposed || cost > this.#deltaPolicy.baselineBytes) return metadata
    const key = payload.path + '\0' + metadata.canonicalHash
    const existing = this.#baselines.get(key)
    if (existing !== undefined) { this.#baselineBytes -= existing.cost; this.#baselines.delete(key) }
    while (this.#baselines.size >= this.#deltaPolicy.baselineEntries || this.#baselineBytes + cost > this.#deltaPolicy.baselineBytes) {
      const oldest = this.#baselines.keys().next().value!
      this.#baselineBytes -= this.#baselines.get(oldest)!.cost
      this.#baselines.delete(oldest)
    }
    this.#baselines.set(key, { text, payload, metadata, cost })
    this.#baselineBytes += cost
    return metadata
  }

  #boundedDelta(result: Extract<UserFileDeltaResult, { kind: 'patch' | 'unchanged' }>, limit: number): UserFileDeltaResult {
    // UTF-16 lengths are a cheap lower bound; JSON escaping and UTF-8 are measured only for bounded candidates.
    let minimumBytes = result.version.length
    if (result.kind === 'patch') {
      for (const range of result.ranges) {
        minimumBytes += range.replacement.length + range.expectedHash.length
        if (minimumBytes > limit) return { kind: 'manual-required', reason: 'too-large' }
      }
    }
    if (minimumBytes > limit || Buffer.byteLength(JSON.stringify({ ok: true, value: result })) > limit) {
      return { kind: 'manual-required', reason: 'too-large' }
    }
    return result
  }

  /**
   * Read a bounded delta from a path-scoped retained canonical baseline.
   * @param path Existing text file. @param baseHash Lowercase canonical SHA-256. @param signal Request cancellation.
   * @param request Approval, response ceiling and background admission preference.
   * @returns Metadata, hash-checked patches, manual-read requirement or a non-queued busy response.
   */
  async deltaText(
    path: string, baseHash: string, signal: AbortSignal,
    request: Pick<UserFileDeltaRequest, 'allowLargeFile' | 'maxConfirmedBytes' | 'maxPatchBytes' | 'background'> = {},
  ): Promise<UserFileDeltaResult> {
    signal.throwIfAborted()
    const policy = this.#textPolicy(path, request.allowLargeFile === true, request.maxConfirmedBytes)
    if (!/^[a-f\d]{64}$/u.test(baseHash) || (request.maxPatchBytes !== undefined
      && (!Number.isSafeInteger(request.maxPatchBytes) || request.maxPatchBytes <= 0))) {
      throw new UserFileFilesystemError('invalid-request', path, 'delta requests require a lowercase SHA-256 and positive safe-integer byte ceiling')
    }
    const limit = Math.min(this.#deltaPolicy.maxDeltaBytes, request.maxPatchBytes ?? this.#deltaPolicy.maxDeltaBytes)
    const input = normalizedAbsolute(path)
    const background = request.background === true
    if (background && this.#activeDeltas >= this.#deltaPolicy.deltaConcurrency) return { kind: 'busy' }
    if (background) this.#activeDeltas++
    try {
      const canonical = await realpath(input)
      const info = await stat(canonical)
      signal.throwIfAborted()
      if (!info.isFile()) throw new UserFileFilesystemError('not-file', canonical, `path "${canonical}" is not a regular file`)
      this.#checkSize(canonical, info.size, policy)
      const key = canonical + '\0' + baseHash
      const baseline = this.#baselines.get(key)
      if (baseline === undefined) return { kind: 'manual-required', reason: 'base-missing' }
      this.#baselines.delete(key)
      this.#baselines.set(key, baseline)
      if (sameStat(baseline.payload.stat, exactStat(info))) return this.#boundedDelta({ kind: 'unchanged', ...baseline.metadata }, limit)
      if (info.size > this.#deltaPolicy.baselineBytes / 2) return { kind: 'manual-required', reason: 'too-large' }
      const current = await this.#readFileBytes(canonical, signal, policy)
      const decoded = decodeText(current.bytes, canonical)
      const text = canonicalText(decoded)
      const metadata = this.#remember(text, { ...current.payload, ...eolMetadata(decoded) })
      if (metadata.canonicalHash === baseHash) return this.#boundedDelta({ kind: 'unchanged', ...metadata }, limit)
      const changes = await this.#deltaBackend.diff(baseline.text, text, signal)
      signal.throwIfAborted()
      if (changes === undefined) return { kind: 'manual-required', reason: 'diff-budget' }
      const ranges: UserFileTextPatch[] = []
      let replacementLength = 0
      for (const change of changes) {
        replacementLength += change.replacement.length
        if (replacementLength > limit) return { kind: 'manual-required', reason: 'too-large' }
        ranges.push({ startLine: change.startLine, lineCount: change.lineCount,
          replacement: change.replacement, expectedHash: sha256(Buffer.from(change.oldText)) })
      }
      return this.#boundedDelta({ kind: 'patch', ranges, ...metadata }, limit)
    } catch (error: unknown) {
      signal.throwIfAborted()
      throw mapNodeError(error, input)
    } finally {
      if (background) this.#activeDeltas--
    }
  }

  #textPolicy(path: string, allowLargeFile: boolean, maxConfirmedBytes: number | undefined): FileSizePolicy {
    if (maxConfirmedBytes !== undefined && (!Number.isSafeInteger(maxConfirmedBytes) || maxConfirmedBytes <= 0)) {
      throw new UserFileFilesystemError('invalid-request', path, 'maxConfirmedBytes must be a positive safe integer')
    }
    const automaticThreshold = allowLargeFile ? Infinity : this.#maxTextReadBytes
    return { kind: 'text', thresholdBytes: Math.min(automaticThreshold, maxConfirmedBytes ?? Infinity) }
  }

  #checkSize(path: string, sizeBytes: number, policy: FileSizePolicy): void {
    if (policy.kind === 'text') {
      if (sizeBytes > policy.thresholdBytes) {
        throw new UserFileConfirmationRequiredError(path, sizeBytes, policy.thresholdBytes)
      }
    } else if (sizeBytes > this.#maxByteReadBytes) {
      throw new UserFileFilesystemError('too-large', path, `path "${path}" exceeds the configured resource limit`)
    }
  }

  async #readFileBytes(path: string, signal: AbortSignal, policy: FileSizePolicy, readVersion?: string): Promise<ReadBytesResult> {
    return await this.#withReadFile(path, signal, policy, readVersion, async (handle, canonical, before) => {
      const bytes = await handle.readFile({ signal })
      signal.throwIfAborted()
      if (bytes.byteLength !== before.size) {
        throw new UserFileFilesystemError('stale-version', canonical, `path "${canonical}" changed while it was read`)
      }
      return { path: canonical, bytes, payload: { format: 1, path: canonical, stat: before, sha256: sha256(bytes), eol: 'none' } }
    })
  }

  async #withReadFile<T>(
    path: string, signal: AbortSignal, policy: FileSizePolicy, readVersion: string | undefined,
    read: (handle: FileHandle, canonical: string, before: ExactStat) => Promise<T>,
  ): Promise<T> {
    signal.throwIfAborted()
    const input = normalizedAbsolute(path)
    try {
      const canonical = await realpath(input)
      const handle = await open(canonical, 'r')
      let closing: Promise<void> | undefined
      const close = (): Promise<void> => closing ??= handle.close()
      const onAbort = (): void => {
        void close().catch(() => { /* The finally block awaits and reports this close failure. */ })
      }
      signal.addEventListener('abort', onAbort, { once: true })
      try {
        signal.throwIfAborted()
        const info = await handle.stat()
        if (!info.isFile()) throw new UserFileFilesystemError('not-file', canonical, `path "${canonical}" is not a regular file`)
        this.#checkSize(canonical, info.size, policy)
        const before = exactStat(info)
        const expected = textReadVersion(canonical, before)
        if (readVersion !== undefined && readVersion !== expected) {
          throw new UserFileFilesystemError('stale-version', canonical, `path "${canonical}" changed after the read was prepared`)
        }
        signal.throwIfAborted()
        const result = await read(handle, canonical, before)
        signal.throwIfAborted()
        const after = exactStat(await handle.stat())
        const currentPath = await realpath(input)
        const current = exactStat(await stat(currentPath))
        if (!sameStat(before, after) || textReadVersion(currentPath, current) !== expected) {
          throw new UserFileFilesystemError('stale-version', canonical, `path "${canonical}" changed while it was read`)
        }
        signal.throwIfAborted()
        return result
      } finally {
        signal.removeEventListener('abort', onAbort)
        await close()
      }
    } catch (error: unknown) {
      signal.throwIfAborted()
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
