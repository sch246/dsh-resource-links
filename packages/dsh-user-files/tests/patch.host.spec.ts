import { createHash } from 'node:crypto'
import { mkdtemp, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { UserFileFilesystem } from '../src/filesystem.ts'
import type { UserFileTextPatch } from '../src/types.ts'

vi.mock('node:fs/promises', async importOriginal => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  return { ...original, open: vi.fn(original.open), rename: vi.fn(original.rename) }
})

let root: string
let path: string
const filesystem = new UserFileFilesystem(32, 64)
const signal = new AbortController().signal
const hash = (text: string): string => createHash('sha256').update(text).digest('hex')
const patch = (startLine: number, lineCount: number, old: string, replacement: string): UserFileTextPatch =>
  ({ startLine, lineCount, expectedHash: hash(old), replacement })
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-text-patch-'))
  path = join(root, 'file.txt')
})
afterEach(async () => {
  vi.restoreAllMocks()
  vi.mocked(open).mockReset()
  vi.mocked(rename).mockReset()
  await rm(root, { recursive: true, force: true })
})

it('keeps external changes outside target ranges and preserves BOM, mixed EOLs and original coordinates', async () => {
  await writeFile(path, '\uFEFFoutside\r\na\rb\nc')
  const before = await filesystem.readText(path, signal)
  const ranges = [patch(1, 1, 'a\n', 'A\nextra\n'), patch(3, 1, 'c', 'C')]
  await writeFile(path, '\uFEFFexternal\r\na\rb\nc')
  const saved = await filesystem.patchText(path, ranges, signal)
  expect(await readFile(path, 'utf8')).toBe('\uFEFFexternal\r\nA\rextra\rb\nC')
  const actual = await filesystem.readText(path, signal)
  expect(saved).toEqual({ version: actual.version, sizeBytes: actual.sizeBytes, canonicalHash: hash(actual.text) })
  expect(saved.version).not.toBe(before.version)
  expect(actual.text).toBe('external\nA\nextra\nb\nC')
})

it('preserves matching insertion context endings and exact replacement terminal newlines', async () => {
  await writeFile(path, 'a\r\nb\rc\nlast')
  await filesystem.patchText(path, [patch(0, 3, 'a\nb\nc\n', 'a\ninsert\nb\nc\n')], signal)
  expect(await readFile(path, 'utf8')).toBe('a\r\ninsert\rb\rc\nlast')
  await filesystem.patchText(path, [patch(4, 1, 'last', 'last\n')], signal)
  expect(await readFile(path, 'utf8')).toBe('a\r\ninsert\rb\rc\nlast\n')
  await filesystem.patchText(path, [patch(4, 1, 'last\n', '')], signal)
  expect(await readFile(path, 'utf8')).toBe('a\r\ninsert\rb\rc\n')
})

it('allows zero-count insertion only for an empty canonical file and permits local output growth', async () => {
  await writeFile(path, '\uFEFF')
  const replacement = 'é\n'.repeat(40)
  const saved = await filesystem.patchText(path, [patch(0, 0, '', replacement)], signal, false, 3)
  expect(saved.sizeBytes).toBe(123)
  expect(saved.canonicalHash).toBe(hash(replacement))
  expect(await readFile(path, 'utf8')).toBe('\uFEFF' + replacement)
  expect((await filesystem.readText(path, signal, true)).version).toBe(saved.version)
  await expect(filesystem.patchText(path, [patch(0, 0, '', 'x')], signal, true)).rejects.toMatchObject({ code: 'stale-version' })
  await filesystem.patchText(path, [patch(0, 40, replacement, '')], signal, true)
  expect(await readFile(path, 'utf8')).toBe('\uFEFF')
})

it('rejects every stale, out-of-bounds, unordered or overlapping range before staging any changes', async () => {
  await writeFile(path, 'a\nb\nc')
  const cases = [
    [patch(0, 1, 'wrong\n', 'A\n')],
    [patch(0, 1, 'a\n', 'A\n'), patch(1, 1, 'wrong\n', 'B\n')],
    [patch(3, 1, '', 'x')], [patch(0, 4, 'a\nb\nc', 'x')],
    [patch(0, 2, 'a\nb\n', 'x'), patch(1, 1, 'b\n', 'y')],
    [patch(1, 1, 'b\n', 'x'), patch(0, 1, 'a\n', 'y')],
    [patch(-1, 1, '', 'x')], [patch(0.5, 1, '', 'x')], [patch(0, 0, '', 'x')],
    [patch(3, 0, '', 'x')],
  ]
  for (const ranges of cases) {
    await expect(filesystem.patchText(path, ranges, signal)).rejects.toMatchObject({ code: 'stale-version' })
  }
  expect(vi.mocked(open).mock.calls.every(call => call[1] === 'r')).toBe(true)
  expect(await readFile(path, 'utf8')).toBe('a\nb\nc')
  expect(await readdir(root)).toEqual(['file.txt'])
})

it('validates canonical replacements and hash spelling before file access and refuses non-text input', async () => {
  for (const replacement of ['a\rb', 'a\0b', '\ud800', '\udc00']) {
    await expect(filesystem.patchText(path, [patch(0, 1, 'a', replacement)], signal)).rejects.toMatchObject({ code: 'invalid-request' })
  }
  for (const expectedHash of ['', hash('a').toUpperCase(), 'a'.repeat(63)]) {
    await expect(filesystem.patchText(path, [{ ...patch(0, 1, 'a', 'b'), expectedHash }], signal)).rejects.toMatchObject({ code: 'invalid-request' })
  }
  expect(open).not.toHaveBeenCalled()
  for (const bytes of [Buffer.from([0xc3, 0x28]), Buffer.from([97, 0])]) {
    await writeFile(path, bytes)
    await expect(filesystem.patchText(path, [patch(0, 1, 'a', 'b')], signal)).rejects.toMatchObject({ code: 'not-text' })
    expect(await readFile(path)).toEqual(bytes)
  }
})

it('checks the confirmed ceiling by stat before reading content', async () => {
  await writeFile(path, 'x'.repeat(33))
  const original = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  const reads = vi.fn()
  vi.mocked(open).mockImplementation(async (...args) => {
    const handle = await original.open(...args)
    vi.spyOn(handle, 'readFile').mockImplementation(reads)
    return handle
  })
  for (const [allow, ceiling] of [[false, undefined], [true, 32]] as const) {
    await expect(filesystem.patchText(path, [patch(0, 1, 'x'.repeat(33), 'y')], signal, allow, ceiling))
      .rejects.toMatchObject({ code: 'confirmation-required', sizeBytes: 33, thresholdBytes: 32 })
  }
  expect(reads).not.toHaveBeenCalled()
  expect(rename).not.toHaveBeenCalled()
})

it('rechecks the entire server snapshot after staging and cleans up on concurrent changes or cancellation', async () => {
  const original = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  for (const cancel of [false, true]) {
    await writeFile(path, 'a\nb')
    const controller = new AbortController()
    vi.mocked(open).mockImplementation(async (...args) => {
      const handle = await original.open(...args)
      if (args[1] === 'wx') {
        const sync = handle.sync.bind(handle)
        vi.spyOn(handle, 'sync').mockImplementation(async () => {
          await sync()
          if (cancel) controller.abort()
          else await writeFile(path, 'a\nexternal')
        })
      }
      return handle
    })
    await expect(filesystem.patchText(path, [patch(0, 1, 'a\n', 'A\n')], controller.signal))
      .rejects.toMatchObject(cancel ? { cause: { name: 'AbortError' } } : { code: 'stale-version' })
    expect(await readFile(path, 'utf8')).toBe(cancel ? 'a\nb' : 'a\nexternal')
    expect(await readdir(root)).toEqual(['file.txt'])
    expect(rename).not.toHaveBeenCalled()
  }
})

it('returns committed metadata when cancellation arrives after rename', async () => {
  await writeFile(path, 'a')
  const controller = new AbortController()
  const original = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  vi.mocked(rename).mockImplementationOnce(async (source, destination) => {
    await original.rename(source, destination)
    controller.abort()
  })
  const saved = await filesystem.patchText(path, [patch(0, 1, 'a', 'b')], controller.signal)
  expect(saved.canonicalHash).toBe(hash('b'))
  expect(saved.version).toBe((await filesystem.readText(path, signal)).version)
  expect(await readdir(root)).toEqual(['file.txt'])
})

it('returns current metadata for empty ranges without staging or changing the file', async () => {
  await writeFile(path, '\uFEFFa\r\nb')
  const current = await filesystem.readText(path, signal)
  const result = await filesystem.patchText(path, [], signal)
  expect(result).toEqual({ version: current.version, sizeBytes: current.sizeBytes, canonicalHash: hash(current.text) })
  expect(vi.mocked(open).mock.calls.every(call => call[1] === 'r')).toBe(true)
  expect(rename).not.toHaveBeenCalled()
})
