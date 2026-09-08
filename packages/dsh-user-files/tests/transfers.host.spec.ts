import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { UserFileFilesystem } from '../src/filesystem.ts'
import { createServer } from 'node:http'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough, Readable } from 'node:stream'
import { expect, it } from 'vitest'
import { registerFileTransfers, uploadFile } from '../src/transfers.ts'

it('streams exact binary files with original names, authenticates, and refuses overwrite and oversized uploads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-transfer-'))
  let route: WebRoute
  let dispose!: () => Promise<void>
  const filesystem = new UserFileFilesystem(8, 8)
  registerFileTransfers({
    effect: (effect: () => () => Promise<void>) => { dispose = effect() },
    webServer: { register: (value: WebRoute) => { route = value; return () => {} } },
    connection: { requestRejection: (req: { headers: { cookie?: string } }) => req.headers.cookie === 'authenticated' ? undefined : 401 },
    userFiles: { filesystem, absolute: async (request: { path: string }) => request.path },
  } as unknown as Context, 1024 * 1024)
  const server = createServer((req, res) => { void route.handler(req, res) })
  try {
    await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing TCP address')
    const url = (path: string, name?: string): string => `http://127.0.0.1:${address.port}/api/user-files/transfer?${new URLSearchParams({ sessionId: 'transfer-session', path, ...(name ? { name } : {}) })}`
    const headers = { cookie: 'authenticated' }
    const name = '原始 % bytes.bin'
    const path = join(root, name)
    const bytes = Buffer.from(Array.from({ length: 128 * 1024 }, (_, i) => i % 256))
    expect((await fetch(url(root, name), { method: 'PUT', body: bytes })).status).toBe(401)
    expect(await readdir(root)).toEqual([])
    expect((await fetch(url(root, name), { method: 'PUT', headers, body: bytes })).status).toBe(201)
    expect(await readFile(path)).toEqual(bytes)
    expect((await fetch(url(root, name), { method: 'PUT', headers, body: 'replace' })).status).toBe(409)
    expect(await readFile(path)).toEqual(bytes)
    const response = await fetch(url(path), { headers })
    expect(response.headers.get('content-disposition')).toBe(`attachment; filename*=UTF-8''${encodeURIComponent(name)}`)
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes)
    expect((await fetch(url(path), { method: 'HEAD', headers })).status).toBe(200)
    expect((await fetch(url(root), { method: 'HEAD', headers })).status).toBe(400)
    expect((await fetch(url(root, 'oversized'), { method: 'PUT', headers, body: Buffer.alloc(1024 * 1024 + 1) })).status).toBe(413)
    expect((await fetch(url(root, '../escape'), { method: 'PUT', headers, body: 'bad' })).status).toBe(400)
    await writeFile(join(root, 'empty'), '')
    expect((await fetch(url(join(root, 'empty')), { headers })).headers.get('content-length')).toBe('0')
    expect((await readdir(root)).sort()).toEqual(['empty', name].sort())
  } finally {
    await dispose()
    await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections() })
    await rm(root, { recursive: true, force: true })
  }
})

it('removes staged bytes when an in-progress upload is cancelled', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-transfer-cancel-'))
  const input = new PassThrough()
  const controller = new AbortController()
  const filesystem = new UserFileFilesystem(8, 8)
  try {
    const done = uploadFile(filesystem, root, 'cancelled.bin', input, 1024, controller.signal)
    const rejected = expect(done).rejects.toMatchObject({ name: 'AbortError' })
    // Only the upload pipeline resumes this source; abort after its first write.
    await new Promise<void>((resolve, reject) => {
      input.once('resume', () => {
        input.write(Buffer.alloc(512), error => {
          if (error) reject(error)
          else { controller.abort(); resolve() }
        })
      })
    })
    await rejected
    expect(await readdir(root)).toEqual([])
  } finally {
    input.destroy()
    await rm(root, { recursive: true, force: true })
  }
})

it('enforces the byte bound while streaming a body without Content-Length', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-transfer-bound-'))
  try {
    await expect(uploadFile(new UserFileFilesystem(8, 8), root, 'large.bin', Readable.from([Buffer.alloc(512), Buffer.alloc(513)]), 1024, new AbortController().signal))
      .rejects.toMatchObject({ status: 413 })
    expect(await readdir(root)).toEqual([])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
