import { createHash } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, open, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { UserFileFilesystem, maxTextReadChunkBytes } from '../src/filesystem.ts'
import { Config } from '../src/index.ts'
import { UserFileRemote } from '../src/remote.ts'

vi.mock('node:fs/promises', async importOriginal => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  return { ...original, open: vi.fn(original.open) }
})

let root: string
let filesystem: UserFileFilesystem
const signal = new AbortController().signal
const hash = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-text-chunks-'))
  filesystem = new UserFileFilesystem(32, 4096, undefined, 4)
})
afterEach(async () => {
  filesystem.dispose()
  vi.restoreAllMocks()
  vi.mocked(open).mockReset()
  await rm(root, { recursive: true, force: true })
})

it('assembles out-of-order raw chunks across UTF-8, BOM and CRLF and finishes with the ordinary revision and delta baseline', async () => {
  const path = join(root, 'mixed.txt')
  const original = Buffer.from('\ufeff😀\r\nx\ry\nend')
  await writeFile(path, original)
  const plan = await filesystem.prepareTextRead(path, signal)
  expect(open).not.toHaveBeenCalled()
  expect(plan).toMatchObject({ path, sizeBytes: original.length, chunkBytes: 4, readVersion: expect.stringMatching(/^[a-f\d]{64}$/u) })
  const offsets = Array.from({ length: Math.ceil(plan.sizeBytes / plan.chunkBytes) }, (_, i) => i * plan.chunkBytes).reverse()
  const chunks = await Promise.all(offsets.map(offset => filesystem.readTextChunk(path, plan.readVersion, offset, signal)))
  for (const chunk of chunks) {
    const bytes = Buffer.from(chunk.dataBase64, 'base64')
    expect(bytes).toEqual(original.subarray(chunk.offset, chunk.offset + 4))
    expect(chunk.sha256).toBe(hash(bytes))
  }
  const native = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  const handle = await native.open(path, 'r')
  const read = handle.read.bind(handle)
  vi.spyOn(handle, 'read').mockImplementation(async (buffer, offset, _length, position) => await read(buffer, offset, 1, position))
  vi.mocked(open).mockResolvedValueOnce(handle)
  expect(await filesystem.readTextChunk(path, plan.readVersion, 0, signal)).toEqual(chunks.at(-1))
  const assembled = Buffer.concat(chunks.reverse().map(chunk => Buffer.from(chunk.dataBase64, 'base64')))
  expect(assembled).toEqual(original)
  const finished = await filesystem.finishTextRead(path, plan.readVersion, signal)
  expect(finished).toEqual({ version: expect.any(String), sizeBytes: original.length, canonicalHash: hash('😀\nx\ny\nend') })
  expect(await filesystem.deltaText(path, finished.canonicalHash, signal)).toEqual({ kind: 'unchanged', ...finished })
  expect((await filesystem.readText(path, signal)).version).toBe(finished.version)
  await filesystem.saveText(path, 'changed', finished.version, signal)
})

it('checks approval before any content access for plans, chunks and completion, including growth beyond the confirmed ceiling', async () => {
  const path = join(root, 'large.txt')
  await writeFile(path, 'x'.repeat(33))
  await expect(filesystem.prepareTextRead(path, signal)).rejects.toMatchObject({ code: 'confirmation-required', sizeBytes: 33, thresholdBytes: 32 })
  expect(open).not.toHaveBeenCalled()
  const plan = await filesystem.prepareTextRead(path, signal, true, 33)
  await writeFile(path, 'x'.repeat(34))
  const native = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  for (const finish of [false, true]) {
    const handle = await native.open(path, 'r')
    const reads = vi.spyOn(handle, 'read')
    const wholeReads = vi.spyOn(handle, 'readFile')
    const closes = vi.spyOn(handle, 'close')
    vi.mocked(open).mockResolvedValueOnce(handle)
    await expect(finish
      ? filesystem.finishTextRead(path, plan.readVersion, signal, true, 33)
      : filesystem.readTextChunk(path, plan.readVersion, 0, signal, true, 33))
      .rejects.toMatchObject({ code: 'confirmation-required', sizeBytes: 34, thresholdBytes: 33 })
    expect(reads).not.toHaveBeenCalled()
    expect(wholeReads).not.toHaveBeenCalled()
    expect(closes).toHaveBeenCalledOnce()
  }
})

it('rejects stale files before reading, short chunks, and path replacement during chunk or final validation', async () => {
  const path = join(root, 'changing.txt')
  const native = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  await writeFile(path, 'abcdefgh')
  const stale = await filesystem.prepareTextRead(path, signal)
  await writeFile(path, 'x')
  await expect(filesystem.readTextChunk(path, stale.readVersion, 0, signal)).rejects.toMatchObject({ code: 'stale-version' })
  await expect(filesystem.finishTextRead(path, stale.readVersion, signal)).rejects.toMatchObject({ code: 'stale-version' })
  for (const change of ['short', 'replace-chunk', 'replace-finish']) {
    await writeFile(path, 'abcdefgh')
    const plan = await filesystem.prepareTextRead(path, signal)
    const handle = await native.open(path, 'r')
    const closes = vi.spyOn(handle, 'close')
    vi.mocked(open).mockResolvedValueOnce(handle)
    if (change === 'short') {
      vi.spyOn(handle, 'read').mockImplementationOnce(async () => ({ bytesRead: 0, buffer: Buffer.alloc(4) }))
    } else {
      const replacement = join(root, 'replacement')
      await writeFile(replacement, 'ABCDEFGH')
      const stat = handle.stat.bind(handle)
      let calls = 0
      vi.spyOn(handle, 'stat').mockImplementation(async () => {
        if (++calls === 2) await rename(replacement, path)
        return await stat()
      })
    }
    await expect(change === 'replace-finish'
      ? filesystem.finishTextRead(path, plan.readVersion, signal)
      : filesystem.readTextChunk(path, plan.readVersion, 0, signal))
      .rejects.toMatchObject({ code: 'stale-version' })
    expect(closes).toHaveBeenCalledOnce()
  }
})

it('validates offsets, tokens, allocation limits, empty files and text only at completion', async () => {
  const path = join(root, 'edge.txt')
  await writeFile(path, '')
  const empty = await filesystem.prepareTextRead(path, signal)
  expect(await filesystem.finishTextRead(path, empty.readVersion, signal)).toMatchObject({ sizeBytes: 0, canonicalHash: hash('') })
  for (const offset of [0, -1, 1.5, 1, Number.MAX_SAFE_INTEGER + 1]) {
    await expect(filesystem.readTextChunk(path, empty.readVersion, offset, signal)).rejects.toMatchObject({ code: 'invalid-request' })
  }
  await expect(filesystem.finishTextRead(path, 'invalid', signal)).rejects.toMatchObject({ code: 'invalid-request' })
  await expect(filesystem.prepareTextRead(path, signal, true, 0)).rejects.toMatchObject({ code: 'invalid-request' })
  expect(Config({}).textReadChunkBytes).toBe(1048576)
  for (const value of [0, -1, 1.5, maxTextReadChunkBytes + 1]) expect(() => Config({ textReadChunkBytes: value })).toThrow()
  for (const bytes of [Buffer.from([97, 0]), Buffer.from([97, 0xc3]), Buffer.from([97, 0xc3, 0x28])]) {
    await writeFile(path, bytes)
    const plan = await filesystem.prepareTextRead(path, signal)
    expect(Buffer.from((await filesystem.readTextChunk(path, plan.readVersion, 0, signal)).dataBase64, 'base64')).toEqual(bytes)
    await expect(filesystem.finishTextRead(path, plan.readVersion, signal)).rejects.toMatchObject({ code: 'not-text' })
  }
})

it('closes chunk and final file handles once on cancellation and returns the Remote cancellation error', async () => {
  const path = join(root, 'cancel.txt')
  await writeFile(path, 'abcdefgh')
  const plan = await filesystem.prepareTextRead(path, signal)
  const native = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  for (const finish of [false, true]) {
    const controller = new AbortController()
    const handle = await native.open(path, 'r')
    const closes = vi.spyOn(handle, 'close')
    vi.spyOn(handle, 'stat').mockImplementationOnce(async () => {
      controller.abort()
      return await native.stat(path)
    })
    vi.mocked(open).mockResolvedValueOnce(handle)
    await expect(finish
      ? filesystem.finishTextRead(path, plan.readVersion, controller.signal)
      : filesystem.readTextChunk(path, plan.readVersion, 0, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(closes).toHaveBeenCalledOnce()
    expect(handle.fd).toBe(-1)
  }
  const ctx = new Context()
  const fiber = ctx.plugin({ apply(scope: Context) { new UserFileRemote(scope, filesystem, Config({ textReadChunkBytes: 4 })) } })
  try {
    await fiber.await()
    const remote = ctx.get('userFiles') as UserFileRemote
    const request = { sessionId: 'chunks' as SessionId, path }
    const remotePlan = await remote.prepareTextRead(request, signal)
    expect(remotePlan).toEqual(plan)
    const requestVersion = { ...request, readVersion: plan.readVersion }
    expect(await remote.readTextChunk({ ...requestVersion, offset: 4 }, signal)).toMatchObject({ offset: 4, dataBase64: 'ZWZnaA==' })
    expect(await remote.finishTextRead(requestVersion, signal)).toMatchObject({ canonicalHash: hash('abcdefgh') })
    await expect(remote.readTextChunk({ ...requestVersion, offset: 1 }, signal)).rejects.toMatchObject({ code: 'gateway/bad-request' })
    await expect(remote.finishTextRead(requestVersion, AbortSignal.abort())).rejects.toMatchObject({ code: 'gateway/cancelled' })
  } finally { await fiber.dispose() }
})
