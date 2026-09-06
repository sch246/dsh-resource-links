import { createHash } from 'node:crypto'
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
    expect(loaded.sizeBytes).toBe(11)
    await expect(remote.saveText({ ...request, text: loaded.text, version: loaded.version }, signal))
      .rejects.toMatchObject({ code: 'user-files/confirmation-required', details: { path, sizeBytes: 11, thresholdBytes: 4 } })
    const saved = await remote.saveText({ ...request, text: 'large\nedit', version: loaded.version, allowLargeFile: true }, signal)
    expect(saved.version).not.toBe(loaded.version)
    expect(saved.sizeBytes).toBe(11)
    expect(await readFile(path, 'utf8')).toBe('large\r\nedit')
    const small = await remote.saveText({ ...request, text: 'a\n', version: saved.version, allowLargeFile: true }, signal)
    const grown = await remote.saveText({ ...request, text: 'local\nexpansion', version: small.version }, signal)
    expect(await readFile(path, 'utf8')).toBe('local\r\nexpansion')
    const expanded = await remote.readText({ ...request, allowLargeFile: true }, signal)
    expect(expanded.version).toBe(grown.version)
    expect(grown.sizeBytes).toBe(16)
    expect(expanded.sizeBytes).toBe(16)
    await expect(remote.readText({ ...request, allowLargeFile: true, maxConfirmedBytes: 11 }, signal))
      .rejects.toMatchObject({ code: 'user-files/confirmation-required', details: { sizeBytes: 16, thresholdBytes: 11 } })
    await expect(remote.saveText({ ...request, text: 'small', version: grown.version, allowLargeFile: true, maxConfirmedBytes: 11 }, signal))
      .rejects.toMatchObject({ code: 'user-files/confirmation-required', details: { sizeBytes: 16, thresholdBytes: 11 } })
    for (const maxConfirmedBytes of [16, Number.MAX_SAFE_INTEGER]) {
      expect((await remote.readText({ ...request, allowLargeFile: true, maxConfirmedBytes }, signal)).sizeBytes).toBe(16)
    }
    for (const maxConfirmedBytes of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity]) {
      await expect(remote.readText({ ...request, allowLargeFile: true, maxConfirmedBytes }, signal))
        .rejects.toMatchObject({ code: 'gateway/bad-request' })
      await expect(remote.saveText({ ...request, text: 'local', version: grown.version, allowLargeFile: true, maxConfirmedBytes }, signal))
        .rejects.toMatchObject({ code: 'gateway/bad-request' })
    }
    expect(await readFile(path, 'utf8')).toBe('local\r\nexpansion')


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

it('publishes range patches through the Cordis service and maps validation, conflict and cancellation errors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-user-files-patch-remote-'))
  const ctx = new Context()
  const fiber = ctx.plugin({ apply: (scope: Context) => {
    new UserFileRemote(scope, new UserFileFilesystem(4, 8), Config({}))
  } })
  try {
    const path = join(root, 'file.txt')
    await writeFile(path, 'a\r\nb')
    await fiber.await()
    const remote = ctx.get('userFiles') as UserFileRemote
    const expectedHash = createHash('sha256').update('a\n').digest('hex')
    const request = { sessionId: 'patch' as SessionId, path, ranges: [{ startLine: 0, lineCount: 1, expectedHash, replacement: 'A\n' }] }
    const signal = new AbortController().signal
    await expect(remote.patchText({ ...request, maxConfirmedBytes: 0 }, signal)).rejects.toMatchObject({ code: 'gateway/bad-request' })
    await expect(remote.patchText({ ...request, ranges: [{ ...request.ranges[0]!, expectedHash: '' }] }, signal))
      .rejects.toMatchObject({ code: 'gateway/bad-request' })
    const saved = await remote.patchText(request, signal)
    expect(saved).toMatchObject({ sizeBytes: 4, canonicalHash: createHash('sha256').update('A\nb').digest('hex') })
    expect(saved).not.toHaveProperty('text')
    await expect(remote.patchText(request, signal)).rejects.toMatchObject({ code: 'user-files/stale-version' })
    await expect(remote.patchText(request, AbortSignal.abort())).rejects.toMatchObject({ code: 'gateway/cancelled' })
    await writeFile(path, 'large')
    await expect(remote.patchText(request, signal)).rejects.toMatchObject({ code: 'user-files/confirmation-required' })
  } finally {
    await fiber.dispose()
    await rm(root, { recursive: true })
  }
})
