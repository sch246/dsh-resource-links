import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { UserFileFilesystem } from '../src/filesystem.ts'
import { UserFileRemote } from '../src/remote.ts'
import { Config } from '../src/index.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

it('reads through the Cordis service receiver used by Remote dispatch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-manager-remote-'))
  const ctx = new Context()
  const fiber = ctx.plugin({ apply: (scope: Context) => {
    const filesystem = new UserFileFilesystem(1024, 4096)
    new UserFileRemote(scope, filesystem, {
      ...Config({}),
      maxResolveBatchSize: 8,
      maxTextReadBytes: 1024,
      maxByteReadBytes: 4096,
    })
  } })
  try {
    await writeFile(join(root, 'hello.txt'), 'hello\n')
    ctx.provide('sessions', { get: () => ({ header: { cwd: root } }) } as never)
    await fiber.await()
    const remote = ctx.get('userFiles') as UserFileRemote
    expect(Object.hasOwn(UserFileRemote.prototype, 'remove')).toBe(false)
    expect(Object.hasOwn(UserFileRemote.prototype, 'deleteEntry')).toBe(false)
    const signal = new AbortController().signal
    const sessionId = 'remote-fixture' as SessionId
    expect(await remote.resolvePath({ sessionId, path: '.' }, signal)).toMatchObject({ path: root, kind: 'directory' })
    expect(await remote.readText({ sessionId, path: 'hello.txt' }, signal)).toMatchObject({ text: 'hello\n' })
    const bytes = await remote.readBytes({ sessionId, path: 'hello.txt' }, signal)
    expect(bytes.dataBase64).toBe('aGVsbG8K')
    const saved = await remote.saveBytes({
      sessionId,
      path: 'hello.txt',
      dataBase64: 'AP8=',
      version: bytes.version,
    }, signal)
    expect(saved.version).not.toBe(bytes.version)
    expect(new Uint8Array(await readFile(join(root, 'hello.txt')))).toEqual(Uint8Array.of(0, 255))
  } finally {
    await fiber.dispose()
    await rm(root, { recursive: true })
  }
})

it('resolves bounded metadata batches independently without reading content and never downgrades failed trash', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-manager-batch-'))
  const ctx = new Context()
  const filesystem = new UserFileFilesystem(1, 1)
  const textReads = vi.spyOn(filesystem, 'readText')
  const byteReads = vi.spyOn(filesystem, 'readBytes')
  const resolves = vi.spyOn(filesystem, 'resolveExisting')
  const fiber = ctx.plugin({ apply: (scope: Context) => {
    new UserFileRemote(scope, filesystem, {
      ...Config({}),
      maxResolveBatchSize: 5,
      maxTextReadBytes: 1,
      maxByteReadBytes: 1,
    })
  } })
  try {
    const path = join(root, 'image.png')
    await writeFile(path, Uint8Array.of(0, 255, 0))
    ctx.provide('sessions', { get: () => ({ header: { cwd: root } }) } as never)
    await fiber.await()
    const remote = ctx.get('userFiles') as UserFileRemote
    const signal = new AbortController().signal
    const sessionId = 'batch-fixture' as SessionId
    const paths = ['image.png', 'absent', root, '', 'image.png']
    const result = await remote.resolveMany({ sessionId, paths }, signal)
    expect(result.map(item => item.inputPath)).toEqual(paths)
    expect(result).toMatchObject([
      { ok: true, value: { path, kind: 'file', mediaType: 'image/png', size: 3 } },
      { ok: false, error: { code: 'user-files/not-found' } },
      { ok: true, value: { path: root, kind: 'directory' } },
      { ok: false, error: { code: 'user-files/invalid-path' } },
      { ok: true, value: { path } },
    ])
    expect(textReads).not.toHaveBeenCalled()
    expect(byteReads).not.toHaveBeenCalled()
    resolves.mockClear()
    await expect(remote.resolveMany({ sessionId, paths: Array(6).fill(path) }, signal))
      .rejects.toMatchObject({ code: 'user-files/batch-too-large' })
    expect(resolves).not.toHaveBeenCalled()
    expect(await remote.resolveMany({ sessionId, paths: [] }, signal)).toEqual([])
    await expect(remote.resolveMany({ sessionId, paths: [path] }, AbortSignal.abort()))
      .rejects.toMatchObject({ code: 'gateway/cancelled' })
    const controller = new AbortController()
    resolves.mockImplementationOnce(async () => {
      controller.abort()
      return { path, name: 'image.png', kind: 'file' }
    })
    await expect(remote.resolveMany({ sessionId, paths: [path, root] }, controller.signal))
      .rejects.toMatchObject({ code: 'gateway/cancelled' })
    expect(resolves).toHaveBeenCalledTimes(1)
  } finally {
    await fiber.dispose()
    await rm(root, { recursive: true })
  }
})

it('transports typed large-file confirmation details and explicit read/save approval through the service', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-user-files-confirmation-'))
  const ctx = new Context()
  const fiber = ctx.plugin({ apply: (scope: Context) => {
    new UserFileRemote(scope, new UserFileFilesystem(4, 8), {
      ...Config({}), maxTextReadBytes: 4, maxByteReadBytes: 8,
    })
  } })
  try {
    const path = join(root, 'large.txt')
    await writeFile(path, 'large\r\ntext')
    ctx.provide('sessions', { get: () => ({ header: { cwd: root } }) } as never)
    await fiber.await()
    const remote = ctx.get('userFiles') as UserFileRemote
    const request = { sessionId: 'confirmation-fixture' as SessionId, path: 'large.txt' }
    const signal = new AbortController().signal
    await expect(remote.readText(request, signal)).rejects.toMatchObject({
      code: 'user-files/confirmation-required', details: { path, sizeBytes: 11, thresholdBytes: 4 },
    })
    const loaded = await remote.readText({ ...request, allowLargeFile: true }, signal)
    expect(loaded.text).toBe('large\ntext')
    await expect(remote.saveText({ ...request, text: loaded.text, version: loaded.version }, signal))
      .rejects.toMatchObject({ code: 'user-files/confirmation-required', details: { path, sizeBytes: 11, thresholdBytes: 4 } })
    const saved = await remote.saveText({ ...request, text: 'large\nedit', version: loaded.version, allowLargeFile: true }, signal)
    expect(saved.version).not.toBe(loaded.version)
    expect(await readFile(path, 'utf8')).toBe('large\r\nedit')
    const small = await remote.saveText({ ...request, text: 'a\n', version: saved.version, allowLargeFile: true }, signal)
    const grown = await remote.saveText({ ...request, text: 'local\nexpansion', version: small.version }, signal)
    expect(await readFile(path, 'utf8')).toBe('local\r\nexpansion')
    const expanded = await remote.readText({ ...request, allowLargeFile: true }, signal)
    expect(expanded.version).toBe(grown.version)

    await expect(remote.readBytes(request, signal)).rejects.toMatchObject({ code: 'user-files/too-large' })
    await expect(remote.readText({ ...request, allowLargeFile: true }, AbortSignal.abort()))
      .rejects.toMatchObject({ code: 'gateway/cancelled' })
    await expect(remote.readText({ ...request, path: 'missing', allowLargeFile: true }, signal))
      .rejects.toMatchObject({ code: 'user-files/not-found' })
  } finally {
    await fiber.dispose()
    await rm(root, { recursive: true })
  }
})
