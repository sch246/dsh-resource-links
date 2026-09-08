import { createHash } from 'node:crypto'
import { defaultDownloadPolicy, type UserFileDownloadPolicy } from './download-policy.ts'
/** Authenticated binary HTTP transfers, with staged exclusive upload publication. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { UserFileFilesystem } from './filesystem.ts'
import { USER_FILE_TRANSFER_PATH } from './transfer-url.ts'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { constants } from 'node:fs'
import { link, mkdtemp, open, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { Transform, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const inlineMediaTypes = new Set([
  'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/aac', 'audio/flac', 'audio/x-flac',
  'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-matroska',
  'application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp', 'image/x-icon',
])

class TransferError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

/** Stream one complete upload, then publish a hard link that cannot replace an existing entry. @param filesystem Shared metadata and publication queue. @param parent Absolute target directory. @param name Single child filename. @param input Raw binary request. @param maxBytes Inclusive upload bound. @param signal Transfer cancellation. @returns Published path; rejected transfers remove staging data. */
export async function uploadFile(filesystem: UserFileFilesystem, parent: string, name: string, input: Readable, maxBytes: number, signal: AbortSignal): Promise<string> {
  if (!name || name === '.' || name === '..' || /[/\\\0]/u.test(name)) throw new TransferError(400, 'Upload filename must be one non-empty path segment.')
  signal.throwIfAborted()
  const directory = await filesystem.resolveExisting(parent)
  if (directory.kind !== 'directory') throw new TransferError(400, 'Upload target must be a directory.')
  const target = join(directory.path, name)
  const staging = await mkdtemp(join(directory.path, '.dsh-upload-'))
  try {
    signal.throwIfAborted()
    const handle = await open(join(staging, 'content'), 'wx', 0o600)
    let received = 0
    const bound = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length
        callback(received > maxBytes ? new TransferError(413, `Upload exceeds ${maxBytes} bytes.`) : null, chunk)
      },
    })
    await pipeline(input, bound, handle.createWriteStream(), { signal })
    await filesystem.mutate(signal, async () => { await link(join(staging, 'content'), target) })
    return target
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

/** One byte range; undefined means ignored syntax/multipart, null means unsatisfiable. */
function byteRange(header: string | undefined, size: number): { start: number; end: number } | null | undefined {
  if (header === undefined) return undefined
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (match === null || (match[1] === '' && match[2] === '')) return undefined
  const length = BigInt(size)
  if (match[1] === '') {
    const suffix = BigInt(match[2]!)
    if (suffix === 0n || length === 0n) return null
    return { start: Number(suffix >= length ? 0n : length - suffix), end: size - 1 }
  }
  const start = BigInt(match[1]!)
  const end = match[2] === '' ? length - 1n : BigInt(match[2]!)
  if (match[2] !== '' && end < start) return undefined
  if (start >= length) return null
  return { start: Number(start), end: Number(end >= length ? length - 1n : end) }
}

function requiredQuery(url: URL, key: string): string {
  const value = url.searchParams.get(key)
  if (!value || value.includes('\0')) throw new TransferError(400, `Missing or invalid ${key}.`)
  return value
}

function statusOf(error: unknown): number {
  if (error instanceof TransferError) return error.status
  if (error instanceof Error && 'code' in error) {
    if (error.code === 'EEXIST' || error.code === 'already-exists') return 409
    if (error.code === 'ENOENT' || error.code === 'not-found') return 404
    if (error.code === 'invalid-path' || error.code === 'not-directory' || error.code === 'not-file') return 400
  }
  return 500
}

/** Mount one raw-binary route under the same trust and cookie checks as Remote calls. @param ctx Owning Host context. @param maxUploadBytes Inclusive per-file upload bound. @param policy Browser parallel download limits. */
export function registerFileTransfers(ctx: Context, maxUploadBytes: number, policy: UserFileDownloadPolicy = defaultDownloadPolicy): void {
  ctx.effect(() => {
    const lifetime = new AbortController()
    const active = new Set<Promise<void>>()
    const unregister = ctx.webServer.register({
      kind: 'exact', path: USER_FILE_TRANSFER_PATH,
      handler(req, res) {
        const done = transfer(req, res)
        active.add(done)
        const remove = (): void => { active.delete(done) }
        void done.then(remove, remove)
        return done
      },
    })
    async function transfer(req: IncomingMessage, res: ServerResponse): Promise<void> {
      const disconnected = new AbortController()
      const abort = (): void => { disconnected.abort(new Error('File transfer disconnected.')) }
      req.once('aborted', abort)
      res.once('close', abort)
      const signal = AbortSignal.any([lifetime.signal, disconnected.signal])
      res.setHeader('Cache-Control', 'no-store, no-transform')
      try {
        const rejection = ctx.connection.requestRejection(req)
        if (rejection !== undefined) throw new TransferError(rejection, rejection === 401 ? 'Unauthorized.' : 'Forbidden.')
        if (!['PUT', 'GET', 'HEAD'].includes(req.method ?? '')) throw new TransferError(405, 'Use PUT, GET or HEAD.')
        const url = new URL(req.url!, 'http://user-files')
        const request = { sessionId: SessionId(requiredQuery(url, 'sessionId')), path: requiredQuery(url, 'path') }
        const path = await ctx.userFiles.absolute(request, signal)
        if (req.method === 'PUT') {
          const length = req.headers['content-length']
          if (length !== undefined && Number(length) > maxUploadBytes) throw new TransferError(413, `Upload exceeds ${maxUploadBytes} bytes.`)
          await uploadFile(ctx.userFiles.filesystem, path, requiredQuery(url, 'name'), req, maxUploadBytes, signal)
          res.writeHead(201)
          res.end()
          return
        }
        const resolved = await ctx.userFiles.filesystem.resolveExisting(path)
        if (resolved.kind !== 'file') throw new TransferError(400, 'Download target must be a regular file.')
        const handle = await open(resolved.path, constants.O_RDONLY | constants.O_NONBLOCK)
        try {
          const stat = await handle.stat()
          if (!stat.isFile()) throw new TransferError(400, 'Download target must be a regular file.')
          signal.throwIfAborted()
          const version = createHash('sha256').update(JSON.stringify([resolved.path, stat.dev, stat.ino, stat.size, stat.mode, stat.mtimeMs, stat.ctimeMs])).digest('hex')
          const expected = req.headers['x-dsh-file-version']
          if (expected !== undefined && expected !== version) throw new TransferError(412, 'The file changed during download.')
          res.setHeader('X-DSH-File-Version', version)
          res.setHeader('X-DSH-Download-Policy', JSON.stringify({
            downloadConcurrency: policy.downloadConcurrency, downloadChunkBytes: policy.downloadChunkBytes,
            downloadRetries: policy.downloadRetries, downloadTimeoutMs: policy.downloadTimeoutMs,
          }))
          const filename = encodeURIComponent(basename(path)).replace(/['()*]/gu, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
          const disposition = url.searchParams.get('disposition') ?? 'attachment'
          if (disposition !== 'inline' && disposition !== 'attachment') throw new TransferError(400, 'Use inline or attachment disposition.')
          const mediaType = resolved.mediaType ?? 'application/octet-stream'
          // Active documents must use their isolated preview handler, never this same-origin route.
          const inline = disposition === 'inline' && inlineMediaTypes.has(mediaType)
          res.setHeader('Content-Type', mediaType)
          res.setHeader('X-Content-Type-Options', 'nosniff')
          res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${filename}`)
          res.setHeader('Accept-Ranges', 'bytes')
          // Without a representation validator, If-Range cannot establish an unchanged file.
          const range = req.method === 'GET' && req.headers['if-range'] === undefined
            ? byteRange(req.headers.range, stat.size) : undefined
          if (range === null) {
            res.setHeader('Content-Range', `bytes */${stat.size}`)
            res.setHeader('Content-Length', 0)
            res.statusCode = 416
            res.end()
            return
          }
          const start = range?.start ?? 0
          const end = range?.end ?? stat.size - 1
          if (range !== undefined) {
            res.statusCode = 206
            res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`)
          }
          res.setHeader('Content-Length', end - start + 1)
          if (req.method === 'HEAD' || stat.size === 0) res.end()
          else await pipeline(handle.createReadStream({ autoClose: false, start, end }), res, { signal })
        } finally { await handle.close() }
      } catch (error: unknown) {
        if (res.destroyed) return
        if (res.headersSent || signal.aborted) { res.destroy(); return }
        res.removeHeader('Content-Disposition')
        res.removeHeader('Content-Length')
        res.writeHead(statusOf(error), { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end(error instanceof Error ? error.message : String(error))
      } finally {
        req.off('aborted', abort)
        res.off('close', abort)
      }
    }
    return async () => {
      unregister()
      lifetime.abort(new Error('User files HTTP transfers unloaded.'))
      await Promise.all(active)
    }
  }, 'user-files: authenticated streaming transfers')
}
