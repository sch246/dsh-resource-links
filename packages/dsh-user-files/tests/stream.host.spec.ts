import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { UserFileFilesystem } from '../src/filesystem.ts'
import { UserFileRemote } from '../src/remote.ts'
import { Config } from '../src/index.ts'
import type { UserFileTextStreamEvent } from '../src/types.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

vi.mock('node:fs/promises', async importOriginal => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  return { ...original, open: vi.fn(original.open) }
})

let root: string
let filesystem: UserFileFilesystem
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-text-stream-'))
  filesystem = new UserFileFilesystem(1024, 4096)
})
afterEach(async () => {
  vi.restoreAllMocks()
  vi.mocked(open).mockReset()
  await rm(root, { recursive: true, force: true })
})

async function collect(stream: AsyncIterable<UserFileTextStreamEvent>, events: UserFileTextStreamEvent[] = []): Promise<UserFileTextStreamEvent[]> {
  for await (const event of stream) events.push(event)
  return events
}

it('streams UTF-8 and split CRLF before EOF with the same text, hash, EOLs and revision as a complete read', async () => {
  const path = join(root, 'mixed.txt')
  const original = '😀a\r\nb\rc\nend\r'
  await writeFile(path, original)
  const signal = new AbortController().signal
  const loaded = await filesystem.readText(path, signal)
  const native = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  for (const chunkBytes of [1, 2, 5]) {
    const handle = await native.open(path, 'r')
    const reads = vi.spyOn(handle, 'read')
    const wholeReads = vi.spyOn(handle, 'readFile')
    const closes = vi.spyOn(handle, 'close')
    vi.mocked(open).mockResolvedValueOnce(handle)
    const stream = filesystem.streamText(path, signal, chunkBytes)
    const iterator = stream[Symbol.asyncIterator]()
    expect(await iterator.next()).toMatchObject({ value: { kind: 'start', path, sizeBytes: loaded.sizeBytes } })
    expect(reads).not.toHaveBeenCalled()
    const first = await iterator.next()
    expect(first.value).toMatchObject({ kind: 'chunk', bytesRead: chunkBytes })
    expect(reads).toHaveBeenCalledOnce()
    const events = await collect(stream, [first.value as UserFileTextStreamEvent])
    expect(events.filter(event => event.kind === 'chunk').map(event => event.text).join('')).toBe(loaded.text)
    expect(events.at(-1)).toEqual({ kind: 'complete', version: loaded.version, sizeBytes: loaded.sizeBytes })
    expect(reads).toHaveBeenCalledTimes(Math.ceil(loaded.sizeBytes / chunkBytes))
    expect(wholeReads).not.toHaveBeenCalled()
    expect(closes).toHaveBeenCalledOnce()
  }
  await filesystem.saveText(path, loaded.text, loaded.version, signal)
  expect(await readFile(path, 'utf8')).toBe(original)
})

it.each(['', '\ufeffx', '\r\n'])('streams empty, BOM and uniform-EOL content: %j', async original => {
  const path = join(root, 'edge.txt')
  await writeFile(path, original)
  const signal = new AbortController().signal
  const loaded = await filesystem.readText(path, signal)
  const events = await collect(filesystem.streamText(path, signal, 1))
  expect(events.filter(event => event.kind === 'chunk').map(event => event.text).join('')).toBe(loaded.text)
  expect(events.at(-1)).toEqual({ kind: 'complete', version: loaded.version, sizeBytes: loaded.sizeBytes })
})

it('checks confirmation ceilings before any streamed content and validates chunk configuration', async () => {
  const path = join(root, 'large.txt')
  await writeFile(path, 'x'.repeat(2048))
  const native = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  const handle = await native.open(path, 'r')
  const reads = vi.spyOn(handle, 'read')
  const closes = vi.spyOn(handle, 'close')
  vi.mocked(open).mockResolvedValueOnce(handle)
  await expect(collect(filesystem.streamText(path, new AbortController().signal, 16, true, 1024)))
    .rejects.toMatchObject({ code: 'confirmation-required', sizeBytes: 2048, thresholdBytes: 1024 })
  expect(reads).not.toHaveBeenCalled()
  expect(closes).toHaveBeenCalledOnce()
  for (const value of [0, -1, 1.5]) expect(() => Config({ streamChunkBytes: value })).toThrow()
  expect(Config({}).streamChunkBytes).toBe(262144)
  await expect(collect(filesystem.streamText(path, new AbortController().signal, 0, true)))
    .rejects.toMatchObject({ code: 'invalid-request' })
})

it.each([Buffer.from([97, 0]), Buffer.from([97, 0xc3]), Buffer.from([97, 0xc3, 0x28])])(
  'rejects NUL or malformed UTF-8 without completing: %j', async bytes => {
    const path = join(root, 'invalid.txt')
    await writeFile(path, bytes)
    const events: UserFileTextStreamEvent[] = []
    await expect(collect(filesystem.streamText(path, new AbortController().signal, 1), events))
      .rejects.toMatchObject({ code: 'not-text' })
    expect(events.some(event => event.kind === 'chunk')).toBe(true)
    expect(events.some(event => event.kind === 'complete')).toBe(false)
  },
)

it.each(['truncate', 'replace', 'rewrite'])('rejects source %s after partial progress without completion', async change => {
  const path = join(root, 'changing.txt')
  await writeFile(path, 'abcdefgh')
  const stream = filesystem.streamText(path, new AbortController().signal, 2)
  const iterator = stream[Symbol.asyncIterator]()
  await iterator.next()
  await iterator.next()
  if (change === 'replace') {
    const replacement = join(root, 'replacement')
    await writeFile(replacement, 'replaced')
    await rename(replacement, path)
  } else {
    await writeFile(path, change === 'truncate' ? 'x' : 'rewritten')
  }
  const events: UserFileTextStreamEvent[] = []
  await expect(collect(stream, events)).rejects.toMatchObject({ code: 'stale-version' })
  expect(events.some(event => event.kind === 'complete')).toBe(false)
})

it('closes an idle iterator immediately on cancellation and closes when the consumer returns early', async () => {
  const path = join(root, 'cancel.txt')
  await writeFile(path, 'content')
  const native = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  const handle = await native.open(path, 'r')
  const closes = vi.spyOn(handle, 'close')
  vi.mocked(open).mockResolvedValueOnce(handle)
  const controller = new AbortController()
  const iterator = filesystem.streamText(path, controller.signal, 1)[Symbol.asyncIterator]()
  await iterator.next()
  await iterator.next()
  controller.abort()
  expect(closes).toHaveBeenCalledOnce()
  await closes.mock.results[0]?.value
  await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' })
  expect(closes).toHaveBeenCalledOnce()

  const early = await native.open(path, 'r')
  const earlyClose = vi.spyOn(early, 'close')
  vi.mocked(open).mockResolvedValueOnce(early)
  for await (const event of filesystem.streamText(path, new AbortController().signal, 1)) {
    expect(event.kind).toBe('start')
    break
  }
  expect(earlyClose).toHaveBeenCalledOnce()
})

it('streams through the Remote service and preserves typed confirmation and cancellation errors', async () => {
  const path = join(root, 'remote.txt')
  await writeFile(path, 'a\r\nb')
  const ctx = new Context()
  const fiber = ctx.plugin({ apply(scope: Context) {
    new UserFileRemote(scope, new UserFileFilesystem(1, 8), Config({ maxTextReadBytes: 1, streamChunkBytes: 1 }))
  } })
  try {
    await fiber.await()
    const remote = ctx.get('userFiles') as UserFileRemote
    const request = { sessionId: 'stream' as SessionId, path }
    await expect(collect(remote.streamText(request, new AbortController().signal)))
      .rejects.toMatchObject({ code: 'user-files/confirmation-required' })
    const events = await collect(remote.streamText({ ...request, allowLargeFile: true }, new AbortController().signal))
    expect(events.filter(event => event.kind === 'chunk').map(event => event.text).join('')).toBe('a\nb')
    expect(events.at(-1)).toMatchObject({ kind: 'complete', sizeBytes: 4 })
    await expect(collect(remote.streamText({ ...request, allowLargeFile: true }, AbortSignal.abort())))
      .rejects.toMatchObject({ code: 'gateway/cancelled' })
  } finally {
    await fiber.dispose()
  }
})
