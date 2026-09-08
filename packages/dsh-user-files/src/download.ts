/** Bounded parallel Range downloads to a browser-selected file, with native-download fallback. */
import { defaultDownloadPolicy, type UserFileDownloadPolicy } from './download-policy.ts'

/** Bytes committed to the temporary local writer; completion is the download promise resolving. */
export interface DownloadProgress { readonly completedBytes: number; readonly totalBytes: number }
interface Writer {
  write(command: { type: 'write'; position: number; data: ArrayBuffer }): Promise<void>
  truncate(size: number): Promise<void>
  close(): Promise<void>
  abort(reason?: unknown): Promise<void>
}
interface SaveHandle { createWritable(): Promise<Writer> }
interface SaveWindow { showSaveFilePicker?: (options: { suggestedName: string }) => Promise<SaveHandle> }
class DownloadFailure extends Error {
  constructor(message: string, readonly retryable = false) { super(message) }
}

function policyFrom(response: Response): UserFileDownloadPolicy {
  const value: unknown = JSON.parse(response.headers.get('x-dsh-download-policy') ?? 'null')
  if (typeof value !== 'object' || value === null) throw new DownloadFailure('The source does not advertise parallel downloads.')
  const row = value as Record<string, unknown>
  const integer = (key: string, min: number, max: number): number => {
    const value = row[key]
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new DownloadFailure(`Invalid download policy: ${key}`)
    return value
  }
  return {
    downloadConcurrency: integer('downloadConcurrency', 1, 8),
    downloadChunkBytes: integer('downloadChunkBytes', 65536, 16777216),
    downloadRetries: integer('downloadRetries', 0, 5),
    downloadTimeoutMs: integer('downloadTimeoutMs', 1000, 300000),
  }
}

async function checkedHead(url: string, signal: AbortSignal, version?: string): Promise<Response> {
  const response = await fetch(url, { method: 'HEAD', credentials: 'same-origin', signal: AbortSignal.any([signal, AbortSignal.timeout(defaultDownloadPolicy.downloadTimeoutMs)]),
    ...(version === undefined ? {} : { headers: { 'X-DSH-File-Version': version } }),
  })
  if (!response.ok) throw new DownloadFailure(`Download: HTTP ${response.status} ${response.statusText}`)
  return response
}

/** Call directly from a user click so choosing a destination retains browser activation.
 * @param url Same-origin authenticated binary endpoint.
 * @param name Suggested local filename.
 * @param signal Caller cancellation.
 * @param onProgress Progress after each successful positioned write.
 * @param nativeOnly Explicit ordinary download, bypassing the local writer.
 * @returns Completion of the local file commit, or native browser handoff when direct writing is unavailable.
 */
export async function downloadBrowserFile(url: string, name: string, signal: AbortSignal, onProgress?: (progress: DownloadProgress) => void, nativeOnly = false): Promise<void> {
  signal.throwIfAborted()
  const picker = (window as unknown as SaveWindow).showSaveFilePicker
  if (nativeOnly || picker === undefined || !window.isSecureContext) {
    await checkedHead(url, signal)
    signal.throwIfAborted()
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = name
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    return
  }
  let handle: SaveHandle
  try { handle = await picker.call(window, { suggestedName: name }) }
  catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError' && !signal.aborted) return
    throw error
  }
  signal.throwIfAborted()
  const metadata = await checkedHead(url, signal)
  const policy = policyFrom(metadata)
  const rawSize = metadata.headers.get('content-length') ?? ''
  const size = Number(rawSize)
  const version = metadata.headers.get('x-dsh-file-version') ?? ''
  if (!/^\d+$/.test(rawSize) || !Number.isSafeInteger(size) || !/^[a-f0-9]{64}$/.test(version)
    || metadata.headers.get('accept-ranges') !== 'bytes') throw new DownloadFailure('Invalid parallel download metadata.')
  const controller = new AbortController()
  const combined = AbortSignal.any([signal, controller.signal])
  const writer = await handle.createWritable()
  let completed = 0
  let next = 0
  let writeQueue: Promise<void> = Promise.resolve()
  const readRange = async (start: number, end: number): Promise<ArrayBuffer> => {
    for (let attempt = 0; ; attempt++) {
      combined.throwIfAborted()
      const requestSignal = AbortSignal.any([combined, AbortSignal.timeout(policy.downloadTimeoutMs)])
      try {
        const response = await fetch(url, { credentials: 'same-origin', signal: requestSignal,
          headers: { Range: `bytes=${start}-${end}`, 'X-DSH-File-Version': version },
        })
        if (response.status !== 206 || response.headers.get('content-range') !== `bytes ${start}-${end}/${size}`
          || response.headers.get('x-dsh-file-version') !== version) {
          await response.body?.cancel()
          throw new DownloadFailure(`Download range rejected: HTTP ${response.status}. The source may have changed.`, response.status === 408 || response.status === 429 || response.status >= 500)
        }
        const bytes = await response.arrayBuffer()
        if (bytes.byteLength !== end - start + 1) throw new DownloadFailure('Incomplete download range.', true)
        return bytes
      } catch (error: unknown) {
        if (combined.aborted || attempt >= policy.downloadRetries || (error instanceof DownloadFailure && !error.retryable)) throw error
      }
    }
  }
  const worker = async (): Promise<void> => {
    try {
      while (next < size) {
        combined.throwIfAborted()
        const start = next
        next = Math.min(size, start + policy.downloadChunkBytes)
        const data = await readRange(start, next - 1)
        combined.throwIfAborted()
        const write = writeQueue.then(async () => {
          combined.throwIfAborted()
          await writer.write({ type: 'write', position: start, data })
          completed += data.byteLength
          onProgress?.({ completedBytes: completed, totalBytes: size })
        })
        writeQueue = write
        await write
      }
    } catch (error: unknown) { controller.abort(error); throw error }
  }
  try {
    onProgress?.({ completedBytes: 0, totalBytes: size })
    const results = await Promise.allSettled(Array.from({ length: Math.min(policy.downloadConcurrency, Math.ceil(size / policy.downloadChunkBytes)) }, worker))
    const failure = results.find(result => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
    combined.throwIfAborted()
    const final = await checkedHead(url, AbortSignal.any([combined, AbortSignal.timeout(policy.downloadTimeoutMs)]), version)
    if (final.headers.get('x-dsh-file-version') !== version || Number(final.headers.get('content-length')) !== size) throw new DownloadFailure('The source changed during download.')
    await writer.truncate(size)
    combined.throwIfAborted()
    await writer.close()
    onProgress?.({ completedBytes: size, totalBytes: size })
  } catch (error: unknown) {
    controller.abort(error)
    try { await writer.abort(error) } catch { /* A failed or already-closed writer has no pending publication to abort. */ }
    throw error
  }
}
