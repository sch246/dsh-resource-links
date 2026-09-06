import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { UserFileFilesystem, UserFileFilesystemError } from '../src/filesystem.ts'
let root: string
let filesystem: UserFileFilesystem
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-user-files-test-'))
  filesystem = new UserFileFilesystem(1024, 4096)
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })
async function expectCode(operation: Promise<unknown>, code: string): Promise<void> {
  await expect(operation).rejects.toMatchObject({ name: 'UserFileFilesystemError', code })
}
describe('UserFileFilesystem', () => {
  it('canonicalizes EOLs and restores CRLF, mixed EOL, and terminal newline on save', async () => {
    const crlf = join(root, 'crlf.txt')
    await writeFile(crlf, 'one\r\ntwo\r\n')
    const loaded = await filesystem.readText(crlf, new AbortController().signal)
    expect(loaded.text).toBe('one\ntwo\n')
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

  it('rejects malformed UTF-8, NUL, oversized and non-regular reads', async () => {
    const invalid = join(root, 'invalid.txt')
    const nul = join(root, 'nul.txt')
    const large = join(root, 'large.txt')
    await writeFile(invalid, Uint8Array.of(0xc3, 0x28))
    await writeFile(nul, Uint8Array.of(97, 0, 98))
    await writeFile(large, 'x'.repeat(1025))
    await expectCode(filesystem.readText(invalid, new AbortController().signal), 'not-text')
    await expectCode(filesystem.readText(nul, new AbortController().signal), 'not-text')
    await expectCode(filesystem.readText(large, new AbortController().signal), 'too-large')
    await expectCode(filesystem.readText(root, new AbortController().signal), 'not-file')
    expect((await filesystem.readBytes(invalid, new AbortController().signal)).bytes).toEqual(Uint8Array.of(0xc3, 0x28))
    expect((await filesystem.readBytes(nul, new AbortController().signal)).bytes).toEqual(Uint8Array.of(97, 0, 98))
    expect((await filesystem.readBytes(large, new AbortController().signal)).bytes).toHaveLength(1025)
  })

  it('guards exact-byte publication with the same serialized stale revision check', async () => {
    const path = join(root, 'bytes.bin')
    await writeFile(path, Uint8Array.of(1, 2, 3))
    const loaded = await filesystem.readBytes(path, new AbortController().signal)
    await filesystem.saveBytes(path, Uint8Array.of(4, 0, 5), loaded.version, new AbortController().signal)
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
    await writeFile(path, 'base')
    const loaded = await filesystem.readText(path, new AbortController().signal)
    const results = await Promise.allSettled([
      filesystem.saveText(path, 'first', loaded.version, new AbortController().signal),
      filesystem.saveText(path, 'second', loaded.version, new AbortController().signal),
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
