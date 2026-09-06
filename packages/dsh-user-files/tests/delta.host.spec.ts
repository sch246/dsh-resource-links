import { createHash } from 'node:crypto'
import { mkdtemp, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { UserFileFilesystem } from '../src/filesystem.ts'
import { defaultDeltaPolicy } from '../src/delta-policy.ts'
import { applyTextPatches, diffTextLines } from '../src/text-patch.ts'
import { Config } from '../src/index.ts'

vi.mock('node:fs/promises', async importOriginal => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  return { ...original, open: vi.fn(original.open) }
})
let root: string
let path: string
let filesystem: UserFileFilesystem
const signal = new AbortController().signal
const hash = (text: string): string => createHash('sha256').update(text).digest('hex')
const hashText = async (text: string): Promise<string> => hash(text)
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-delta-'))
  path = join(root, 'file.txt')
  filesystem = new UserFileFilesystem(1024, 4096)
})
afterEach(async () => {
  vi.restoreAllMocks()
  vi.mocked(open).mockReset()
  await rm(root, { recursive: true, force: true })
})

it('uses path-scoped baselines and stat-only unchanged observations, then returns hash-checked original-coordinate deltas', async () => {
  await writeFile(path, '\uFEFFa\r\nb\nc')
  const loaded = await filesystem.readText(path, signal)
  const baseHash = hash(loaded.text)
  vi.mocked(open).mockClear()
  expect(await filesystem.deltaText(path, baseHash, signal)).toEqual({ kind: 'unchanged', version: loaded.version, sizeBytes: loaded.sizeBytes, canonicalHash: baseHash })
  expect(open).not.toHaveBeenCalled()
  const other = join(root, 'other.txt')
  await writeFile(other, 'a\nb\nc')
  expect(await filesystem.deltaText(other, baseHash, signal)).toEqual({ kind: 'manual-required', reason: 'base-missing' })
  expect(open).not.toHaveBeenCalled()
  await writeFile(path, '\uFEFFa\r\nnew\r\nb\nc\n')
  const delta = await filesystem.deltaText(path, baseHash, signal)
  expect(delta.kind).toBe('patch')
  if (delta.kind !== 'patch') throw new Error('expected patch')
  expect(await applyTextPatches(loaded.text, delta.ranges, hashText)).toBe('a\nnew\nb\nc\n')
  expect(delta.canonicalHash).toBe(hash('a\nnew\nb\nc\n'))
  vi.mocked(open).mockClear()
  expect((await filesystem.deltaText(path, delta.canonicalHash, signal)).kind).toBe('unchanged')
  expect(open).not.toHaveBeenCalled()
})

it('bounds baseline bytes and LRU entries without loading an unavailable base', async () => {
  filesystem = new UserFileFilesystem(1024, 4096, { ...defaultDeltaPolicy, baselineBytes: 12, baselineEntries: 2 })
  for (const text of ['aa', 'bb', 'cc']) {
    await writeFile(path, text)
    await filesystem.readText(path, signal)
  }
  vi.mocked(open).mockClear()
  expect(await filesystem.deltaText(path, hash('aa'), signal)).toEqual({ kind: 'manual-required', reason: 'base-missing' })
  expect(open).not.toHaveBeenCalled()
  await writeFile(path, 'over-budget')
  await filesystem.readText(path, signal)
  vi.mocked(open).mockClear()
  expect(await filesystem.deltaText(path, hash('over-budget'), signal)).toEqual({ kind: 'manual-required', reason: 'base-missing' })
  expect(await filesystem.deltaText(path, hash('cc'), signal)).toEqual({ kind: 'manual-required', reason: 'too-large' })
  expect(open).not.toHaveBeenCalled()
  filesystem = new UserFileFilesystem(1024, 4096, { ...defaultDeltaPolicy, baselineBytes: 6, baselineEntries: 16 })
  for (const text of ['aa', 'bb']) { await writeFile(path, text); await filesystem.readText(path, signal) }
  vi.mocked(open).mockClear()
  expect(await filesystem.deltaText(path, hash('aa'), signal)).toEqual({ kind: 'manual-required', reason: 'base-missing' })
  expect(open).not.toHaveBeenCalled()
})

it('establishes only completed stream and actual patch-save baselines and clears them on disposal', async () => {
  await writeFile(path, 'a\r\nb')
  const controller = new AbortController()
  const iterator = filesystem.streamText(path, controller.signal, 1)[Symbol.asyncIterator]()
  await iterator.next()
  await iterator.next()
  controller.abort()
  await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' })
  expect(await filesystem.deltaText(path, hash('a\nb'), signal)).toEqual({ kind: 'manual-required', reason: 'base-missing' })
  for await (const _event of filesystem.streamText(path, signal, 1)) { /* Consume validated completion. */ }
  expect((await filesystem.deltaText(path, hash('a\nb'), signal)).kind).toBe('unchanged')
  await writeFile(path, 'a\r\nexternal')
  const saved = await filesystem.patchText(path, [{ startLine: 0, lineCount: 1, expectedHash: hash('a\n'), replacement: 'A\n' }], signal)
  expect(saved.canonicalHash).toBe(hash('A\nexternal'))
  expect((await filesystem.deltaText(path, saved.canonicalHash, signal)).kind).toBe('unchanged')
  const pending = filesystem.streamText(path, signal, 1)[Symbol.asyncIterator]()
  await pending.next()
  filesystem.dispose()
  while (!(await pending.next()).done) { /* Complete an already-open stream after disposal. */ }
  expect(await filesystem.deltaText(path, saved.canonicalHash, signal)).toEqual({ kind: 'manual-required', reason: 'base-missing' })
})

it('checks confirmation before bytes and returns explicit diff-budget and serialized-envelope limits', async () => {
  filesystem = new UserFileFilesystem(4, 4096, { ...defaultDeltaPolicy, deltaMaxEditLength: 1 })
  await writeFile(path, 'a')
  await filesystem.readText(path, signal)
  await writeFile(path, 'bb')
  expect(await filesystem.deltaText(path, hash('a'), signal)).toEqual({ kind: 'manual-required', reason: 'diff-budget' })
  await writeFile(path, 'large')
  vi.mocked(open).mockClear()
  await expect(filesystem.deltaText(path, hash('a'), signal)).rejects.toMatchObject({ code: 'confirmation-required' })
  await expect(filesystem.deltaText(path, hash('a'), signal, { allowLargeFile: true, maxConfirmedBytes: 4 }))
    .rejects.toMatchObject({ code: 'confirmation-required', thresholdBytes: 4 })
  expect(open).not.toHaveBeenCalled()
  filesystem = new UserFileFilesystem(4096, 4096)
  await writeFile(path, 'a')
  await filesystem.readText(path, signal)
  await writeFile(path, '\u0001'.repeat(200))
  const delta = await filesystem.deltaText(path, hash('a'), signal)
  expect(delta.kind).toBe('patch')
  const bytes = Buffer.byteLength(JSON.stringify({ ok: true, value: delta }))
  expect(bytes).toBeGreaterThan(1200)
  expect((await filesystem.deltaText(path, hash('a'), signal, { maxPatchBytes: bytes })).kind).toBe('patch')
  expect(await filesystem.deltaText(path, hash('a'), signal, { maxPatchBytes: bytes - 1 }))
    .toEqual({ kind: 'manual-required', reason: 'too-large' })
  expect(await filesystem.deltaText(path, hash('\u0001'.repeat(200)), signal, { maxPatchBytes: 1 }))
    .toEqual({ kind: 'manual-required', reason: 'too-large' })
})

it('refuses concurrent background work without queueing while manual delta/read/save bypass admission and cancellation releases it', async () => {
  await writeFile(path, 'a\nb')
  await filesystem.readText(path, signal)
  const replacementPath = join(root, 'replacement')
  await writeFile(replacementPath, 'a\nB')
  await rename(replacementPath, path)
  const native = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let entered!: () => void
  const reading = new Promise<void>(resolve => { entered = resolve })
  vi.mocked(open).mockImplementationOnce(async (...args) => {
    const handle = await native.open(...args)
    const read = handle.readFile.bind(handle)
    vi.spyOn(handle, 'readFile').mockImplementationOnce(async () => {
      entered()
      await gate
      return await read()
    })
    return handle
  })
  const controller = new AbortController()
  const pending = filesystem.deltaText(path, hash('a\nb'), controller.signal, { background: true })
  const outcome = pending.catch(error => error)
  try {
    await reading
    expect(await filesystem.deltaText(path, hash('a\nb'), signal, { background: true })).toEqual({ kind: 'busy' })
    expect((await filesystem.deltaText(path, hash('a\nb'), signal, { background: false })).kind).toBe('patch')
    expect((await filesystem.readText(path, signal)).text).toBe('a\nB')
    const saved = await filesystem.patchText(path, [{ startLine: 0, lineCount: 1, expectedHash: hash('a\n'), replacement: 'A\n' }], signal)
    expect(saved.canonicalHash).toBe(hash('A\nB'))
    controller.abort()
  } finally { release() }
  expect(await outcome).toMatchObject({ name: 'AbortError' })
  expect((await filesystem.deltaText(path, hash('A\nB'), signal, { background: true })).kind).toBe('unchanged')
  expect(await readFile(path, 'utf8')).toBe('A\nB')
})

it('validates request and deployment budgets and preserves admission after invalid paths', async () => {
  for (const field of ['maxDeltaBytes', 'baselineBytes', 'baselineEntries', 'deltaConcurrency', 'deltaDiffTimeoutMs', 'deltaMaxEditLength']) {
    for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) expect(() => Config({ [field]: value })).toThrow()
  }
  for (const maxPatchBytes of [0, -1, 1.5, Infinity]) {
    await expect(filesystem.deltaText(path, hash('a'), signal, { maxPatchBytes })).rejects.toMatchObject({ code: 'invalid-request' })
  }
  await expect(filesystem.deltaText(path, 'bad', signal)).rejects.toMatchObject({ code: 'invalid-request' })
  await expect(filesystem.deltaText('relative', hash('a'), signal, { background: true })).rejects.toMatchObject({ code: 'invalid-path' })
  expect(open).not.toHaveBeenCalled()
  await writeFile(path, 'a')
  expect(await filesystem.deltaText(path, hash('a'), signal, { background: true })).toEqual({ kind: 'manual-required', reason: 'base-missing' })
})

it('round-trips canonical diff ranges across insertion context, merges, empty files and terminal newlines', async () => {
  for (const [base, local] of [['', 'a\n'], ['a\n', ''], ['a\nb', 'x\na\nb\ny\n'], ['a\nb\nc\nd', 'a\nx\nb\ny\nc\nD'], ['a\n', 'a'], ['a', 'a\n']]) {
    const changes = diffTextLines(base!, local!)!
    expect(await applyTextPatches(base!, changes.map(change => ({ ...change, expectedHash: hash(change.oldText) })), hashText)).toBe(local)
  }
  expect(diffTextLines('a\n', 'b\n', { maxEditLength: 0 })).toBeUndefined()
  const good = { startLine: 0, lineCount: 1, expectedHash: hash('a\n'), replacement: 'A\n' }
  await expect(applyTextPatches('a\nb', [good, { ...good, startLine: 1 }], hashText)).rejects.toMatchObject({ code: 'stale-version' })
  await expect(applyTextPatches('a\nb', [good, good], hashText)).rejects.toMatchObject({ code: 'stale-version' })
})
