import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp, open, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UserFileFilesystem, UserFileFilesystemError } from '../src/filesystem.ts'
vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  return { ...original, open: vi.fn(original.open), rename: vi.fn(original.rename) }
})

let root: string
let filesystem: UserFileFilesystem
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-user-files-test-'))
  filesystem = new UserFileFilesystem(1024, 4096)
})
afterEach(async () => {
  vi.restoreAllMocks()
  vi.mocked(open).mockReset()
  vi.mocked(rename).mockReset()
  await rm(root, { recursive: true, force: true })
})
async function expectCode(operation: Promise<unknown>, code: string): Promise<void> {
  await expect(operation).rejects.toMatchObject({ name: 'UserFileFilesystemError', code })
}
describe('UserFileFilesystem', () => {
  it('canonicalizes EOLs and restores CRLF, mixed EOL, and terminal newline on save', async () => {
    const crlf = join(root, 'crlf.txt')
    await writeFile(crlf, 'one\r\ntwo\r\n')
    const loaded = await filesystem.readText(crlf, new AbortController().signal)
    expect(loaded.text).toBe('one\ntwo\n')
    expect(loaded.sizeBytes).toBe(10)
    await filesystem.saveText(crlf, loaded.text, loaded.version, new AbortController().signal)
    expect(await readFile(crlf, 'utf8')).toBe('one\r\ntwo\r\n')

    const mixed = join(root, 'mixed.txt')
    await writeFile(mixed, 'a\r\nb\rc\n')
    const mixedLoaded = await filesystem.readText(mixed, new AbortController().signal)
    await filesystem.saveText(mixed, mixedLoaded.text, mixedLoaded.version, new AbortController().signal)
    expect(await readFile(mixed, 'utf8')).toBe('a\r\nb\rc\n')

    const none = join(root, 'none.txt')
    await writeFile(none, 'no newline')
    const noneLoaded = await filesystem.readText(none, new AbortController().signal)
    await filesystem.saveText(none, noneLoaded.text, noneLoaded.version, new AbortController().signal)
    expect(await readFile(none, 'utf8')).toBe('no newline')
  })

  it('rejects malformed UTF-8, NUL and non-regular reads and requests confirmation above the text threshold', async () => {
    const invalid = join(root, 'invalid.txt')
    const nul = join(root, 'nul.txt')
    const large = join(root, 'large.txt')
    await writeFile(invalid, Uint8Array.of(0xc3, 0x28))
    await writeFile(nul, Uint8Array.of(97, 0, 98))
    await writeFile(large, 'x'.repeat(1025))
    await expectCode(filesystem.readText(invalid, new AbortController().signal), 'not-text')
    await expectCode(filesystem.readText(nul, new AbortController().signal), 'not-text')
    await expectCode(filesystem.readText(large, new AbortController().signal), 'confirmation-required')
    await expectCode(filesystem.readText(root, new AbortController().signal), 'not-file')
    expect((await filesystem.readBytes(invalid, new AbortController().signal)).bytes).toEqual(Uint8Array.of(0xc3, 0x28))
    expect((await filesystem.readBytes(nul, new AbortController().signal)).bytes).toEqual(Uint8Array.of(97, 0, 98))
    expect((await filesystem.readBytes(large, new AbortController().signal)).bytes).toHaveLength(1025)
  })

  it('checks file metadata without reading content before requesting confirmation', async () => {
    const path = join(root, 'large.txt')
    await writeFile(path, 'x'.repeat(1025))
    const original = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    const handle = await original.open(path, 'r')
    const reads = vi.spyOn(handle, 'readFile')
    const closes = vi.spyOn(handle, 'close')
    vi.mocked(open).mockResolvedValueOnce(handle)
    await expect(filesystem.readText(path, new AbortController().signal)).rejects.toMatchObject({
      code: 'confirmation-required', path, sizeBytes: 1025, thresholdBytes: 1024,
    })
    expect(reads).not.toHaveBeenCalled()
    expect(closes).toHaveBeenCalledOnce()

    const loaded = await filesystem.readText(path, new AbortController().signal, true)
    vi.mocked(open).mockClear()
    await expect(filesystem.saveText(path, 'small', loaded.version, new AbortController().signal))
      .rejects.toMatchObject({ code: 'confirmation-required', sizeBytes: 1025, thresholdBytes: 1024 })
    expect(open).not.toHaveBeenCalled()
    expect(await readdir(root)).toEqual(['large.txt'])
    expect(await readFile(path, 'utf8')).toBe('x'.repeat(1025))
  })

  it('requires confirmation before reading disk content that grew beyond a prior approval ceiling', async () => {
    const path = join(root, 'growing.txt')
    const signal = new AbortController().signal
    await writeFile(path, 'x'.repeat(2048))
    const loaded = await filesystem.readText(path, signal, true, 2048)
    expect(loaded.sizeBytes).toBe(2048)
    await writeFile(path, 'x'.repeat(2049))
    const original = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    const handle = await original.open(path, 'r')
    const reads = vi.spyOn(handle, 'readFile')
    const closes = vi.spyOn(handle, 'close')
    vi.mocked(open).mockResolvedValueOnce(handle)
    await expect(filesystem.readText(path, signal, true, 2048)).rejects.toMatchObject({
      code: 'confirmation-required', sizeBytes: 2049, thresholdBytes: 2048,
    })
    expect(reads).not.toHaveBeenCalled()
    expect(closes).toHaveBeenCalledOnce()
    vi.mocked(open).mockClear()
    await expect(filesystem.saveText(path, 'local', loaded.version, signal, true, 2048)).rejects.toMatchObject({
      code: 'confirmation-required', sizeBytes: 2049, thresholdBytes: 2048,
    })
    expect(open).not.toHaveBeenCalled()
    expect(await readdir(root)).toEqual(['growing.txt'])
    expect((await filesystem.readText(path, signal, true)).sizeBytes).toBe(2049)
  })

  it('checks the approval ceiling again before the save revision read after staging', async () => {
    const path = join(root, 'revision-growth.txt')
    const signal = new AbortController().signal
    await writeFile(path, 'x'.repeat(2048))
    const loaded = await filesystem.readText(path, signal, true, 2048)
    const original = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    const reads = vi.fn()
    vi.mocked(open).mockImplementation(async (...args) => {
      const handle = await original.open(...args)
      if (args[1] === 'wx') {
        const sync = handle.sync.bind(handle)
        vi.spyOn(handle, 'sync').mockImplementation(async () => {
          await sync()
          await writeFile(path, 'x'.repeat(2049))
        })
      } else {
        vi.spyOn(handle, 'readFile').mockImplementation(reads)
      }
      return handle
    })
    await expect(filesystem.saveText(path, 'replacement', loaded.version, signal, true, 2048))
      .rejects.toMatchObject({ code: 'confirmation-required', sizeBytes: 2049, thresholdBytes: 2048 })
    expect(reads).not.toHaveBeenCalled()
    expect(await readFile(path, 'utf8')).toBe('x'.repeat(2049))
    expect(await readdir(root)).toEqual(['revision-growth.txt'])
  })

  it('uses the lower of the configured threshold and request ceiling without approval', async () => {
    const path = join(root, 'lower.txt')
    const signal = new AbortController().signal
    await writeFile(path, 'x'.repeat(512))
    expect((await filesystem.readText(path, signal, false, 512)).sizeBytes).toBe(512)
    await writeFile(path, 'x'.repeat(513))
    await expect(filesystem.readText(path, signal, false, 512)).rejects.toMatchObject({
      code: 'confirmation-required', sizeBytes: 513, thresholdBytes: 512,
    })
    await writeFile(path, 'x'.repeat(1025))
    for (const approval of [false, undefined]) {
      await expect(filesystem.readText(path, signal, approval, 2048)).rejects.toMatchObject({
        code: 'confirmation-required', sizeBytes: 1025, thresholdBytes: 1024,
      })
    }
  })

  it('rejects invalid confirmation ceilings before direct text reads or saves access the file', async () => {
    const path = join(root, 'absent.txt')
    const signal = new AbortController().signal
    for (const ceiling of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity]) {
      await expectCode(filesystem.readText(path, signal, true, ceiling), 'invalid-request')
      await expectCode(filesystem.saveText(path, 'text', '', signal, true, ceiling), 'invalid-request')
    }
    expect(open).not.toHaveBeenCalled()
    expect(await readdir(root)).toEqual([])
  })

  it('accepts the threshold inclusively and saves larger local edits without confirmation', async () => {
    const path = join(root, 'threshold.txt')
    await writeFile(path, 'x'.repeat(1022) + '\r\n')
    const signal = new AbortController().signal
    const loaded = await filesystem.readText(path, signal, false)
    await filesystem.saveText(path, loaded.text, loaded.version, signal)
    const current = await filesystem.readText(path, signal)
    const replacement = 'é\n'.repeat(2048)
    const saved = await filesystem.saveText(path, replacement, current.version, signal, false, 1024)
    expect(saved.sizeBytes).toBe(8192)
    expect(await readFile(path, 'utf8')).toBe('é\r\n'.repeat(2048))
    const published = await filesystem.readText(path, signal, true)
    expect(published).toMatchObject({ text: replacement, version: saved.version, sizeBytes: 8192 })
    expect(saved.version).not.toBe(current.version)
    await expectCode(filesystem.readText(path, signal), 'confirmation-required')
    await filesystem.saveText(path, 'done\n', saved.version, signal, true)
    expect(await readFile(path, 'utf8')).toBe('done\r\n')
    expect(await readdir(root)).toEqual(['threshold.txt'])
  })

  it('confirms large text reads and saves without a byte cap while preserving EOL and revision guards', async () => {
    const path = join(root, 'confirmed.txt')
    const original = 'a\r\nb\rc\n'.repeat(1024)
    await writeFile(path, original)
    const signal = new AbortController().signal
    const loaded = await filesystem.readText(path, signal, true)
    expect(loaded.text).toBe('a\nb\nc\n'.repeat(1024))
    const saved = await filesystem.saveText(path, loaded.text.replaceAll('a', 'A'), loaded.version, signal, true)
    expect(await readFile(path, 'utf8')).toBe(original.replaceAll('a', 'A'))
    expect(saved.version).not.toBe(loaded.version)
    await expectCode(filesystem.saveText(path, 'stale', loaded.version, signal, true), 'stale-version')
    const current = await filesystem.readText(path, signal, true)
    await expectCode(filesystem.saveBytes(path, Uint8Array.of(1), current.version, signal), 'too-large')
    await expectCode(filesystem.readBytes(path, signal), 'too-large')
    await expectCode(filesystem.readText(path, signal), 'confirmation-required')
    await filesystem.saveText(path, 'small', current.version, signal, true)
    expect((await filesystem.readText(path, signal)).text).toBe('small')
    const small = await filesystem.readBytes(path, signal)
    await expectCode(filesystem.saveBytes(path, new Uint8Array(4097), small.version, signal), 'too-large')
    expect(await readdir(root)).toEqual(['confirmed.txt'])
  })

  it('retains missing-file and cancellation failures for confirmed reads and saves', async () => {
    const path = join(root, 'missing.txt')
    await expectCode(filesystem.readText(path, new AbortController().signal, true), 'not-found')
    await expectCode(filesystem.saveText(path, 'text', '', new AbortController().signal, true), 'not-found')
    await writeFile(path, 'x'.repeat(1025))
    const loaded = await filesystem.readText(path, new AbortController().signal, true)
    await expect(filesystem.readText(path, AbortSignal.abort(), true)).rejects.toMatchObject({ name: 'AbortError' })
    await expect(filesystem.saveText(path, 'text', loaded.version, AbortSignal.abort(), true))
      .rejects.toMatchObject({ name: 'AbortError' })
    expect(await readFile(path, 'utf8')).toBe(loaded.text)
  })

  it('returns the committed large-text revision when cancellation arrives after rename', async () => {
    const path = join(root, 'publication.txt')
    await writeFile(path, 'before'.repeat(1024))
    const controller = new AbortController()
    const loaded = await filesystem.readText(path, controller.signal, true)
    const original = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    vi.mocked(rename).mockImplementationOnce(async (source, destination) => {
      await original.rename(source, destination)
      controller.abort()
    })
    const saved = await filesystem.saveText(path, 'after'.repeat(1024), loaded.version, controller.signal, true)
    expect(controller.signal.aborted).toBe(true)
    expect(saved.sizeBytes).toBe(5120)
    expect(saved.version).toBe((await filesystem.readText(path, new AbortController().signal, true)).version)
    expect(await readFile(path, 'utf8')).toBe('after'.repeat(1024))
  })

  it('guards exact-byte publication with the same serialized stale revision check', async () => {
    const path = join(root, 'bytes.bin')
    await writeFile(path, Uint8Array.of(1, 2, 3))
    const loaded = await filesystem.readBytes(path, new AbortController().signal)
    const saved = await filesystem.saveBytes(path, Uint8Array.of(4, 0, 5), loaded.version, new AbortController().signal)
    expect(saved.sizeBytes).toBe(3)
    expect(new Uint8Array(await readFile(path))).toEqual(Uint8Array.of(4, 0, 5))

    const stale = await filesystem.readBytes(path, new AbortController().signal)
    await writeFile(path, Uint8Array.of(9))
    await expectCode(
      filesystem.saveBytes(path, Uint8Array.of(8), stale.version, new AbortController().signal),
      'stale-version',
    )
    expect(new Uint8Array(await readFile(path))).toEqual(Uint8Array.of(9))
  })

  it('detects an external mutation and never clobbers its content', async () => {
    const path = join(root, 'concurrent.txt')
    await writeFile(path, 'original')
    const loaded = await filesystem.readText(path, new AbortController().signal)
    await writeFile(path, 'external')
    await expectCode(
      filesystem.saveText(path, 'mine', loaded.version, new AbortController().signal),
      'stale-version',
    )
    expect(await readFile(path, 'utf8')).toBe('external')
  })

  it('rejects a malformed opaque revision before publication', async () => {
    const path = join(root, 'revision.txt')
    await writeFile(path, 'original')
    const loaded = await filesystem.readText(path, new AbortController().signal)
    const payload = JSON.parse(Buffer.from(loaded.version, 'base64url').toString('utf8')) as Record<string, unknown>
    payload.sha256 = 'not-a-content-hash'
    const malformed = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url') as typeof loaded.version

    await expectCode(filesystem.saveText(path, 'mine', malformed, new AbortController().signal), 'stale-version')
    expect(await readFile(path, 'utf8')).toBe('original')
  })

  it('serializes own writes so two saves from one revision cannot both publish', async () => {
    const path = join(root, 'serialized.txt')
    await writeFile(path, 'base'.repeat(1024))
    const loaded = await filesystem.readText(path, new AbortController().signal, true)
    const results = await Promise.allSettled([
      filesystem.saveText(path, 'first', loaded.version, new AbortController().signal, true),
      filesystem.saveText(path, 'second', loaded.version, new AbortController().signal, true),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const failure = results.find(result => result.status === 'rejected') as PromiseRejectedResult
    expect(failure.reason).toBeInstanceOf(UserFileFilesystemError)
    expect(failure.reason).toMatchObject({ code: 'stale-version' })
    expect(['first', 'second']).toContain(await readFile(path, 'utf8'))
  })

  // Windows CI cannot create symbolic links without host policy that this plugin does not own.
  it.skipIf(process.platform === 'win32')('follows a file symlink for stable read and save identity', async () => {
    const target = join(root, 'target.txt')
    const link = join(root, 'link.txt')
    await writeFile(target, 'before')
    await symlink(target, link)
    const loaded = await filesystem.readText(link, new AbortController().signal)
    expect(loaded.path).toBe(target)
    await filesystem.saveText(loaded.path, 'after', loaded.version, new AbortController().signal)
    expect(await readFile(target, 'utf8')).toBe('after')
  })
  it.skipIf(process.platform === 'win32')('serializes text and bytes addressed through distinct canonical aliases', async () => {
    const path = join(root, 'shared.txt')
    const alias = join(root, 'alias.txt')
    await writeFile(path, 'base')
    await symlink(path, alias)
    const text = await filesystem.readText(path, new AbortController().signal)
    const bytes = await filesystem.readBytes(alias, new AbortController().signal)
    const results = await Promise.allSettled([
      filesystem.saveText(path, 'text', text.version, new AbortController().signal),
      filesystem.saveBytes(alias, Uint8Array.of(0, 255), bytes.version, new AbortController().signal),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect((results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ code: 'stale-version' })
    const saved = await readFile(path)
    expect(saved.equals(Buffer.from('text')) || saved.equals(Buffer.from([0, 255]))).toBe(true)
  })

})
