import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TextDeltaBackend, readHdiffCovers } from '../src/hdiffpatch.ts'
import { defaultDeltaPolicy } from '../src/delta-policy.ts'
import { applyTextPatches } from '../src/text-patch.ts'
import type { TextLineChange } from '../src/text-patch.ts'
import { UserFileFilesystem } from '../src/filesystem.ts'
import { Config } from '../src/index.ts'

let root: string
const owners: { dispose(): Promise<void> }[] = []
const signal = new AbortController().signal
const hash = async (text: string): Promise<string> => createHash('sha256').update(text).digest('hex')
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'dsh-hdiff-test-')) })
afterEach(async () => {
  await Promise.all(owners.splice(0).map(owner => owner.dispose()))
  await rm(root, { recursive: true, force: true })
})
function backend(command: string, mode: 'auto' | 'builtin' | 'hdiffpatch', options = {}): TextDeltaBackend {
  const result = new TextDeltaBackend({ ...defaultDeltaPolicy, deltaDiffTimeoutMs: 5000, ...options, diffBackend: mode, hdiffpatchCommand: command })
  owners.push(result)
  return result
}
async function apply(base: string, changes: TextLineChange[] | undefined): Promise<string> {
  expect(changes).toBeDefined()
  return await applyTextPatches(base, await Promise.all(changes!.map(async change => ({ ...change, expectedHash: await hash(change.oldText) }))), hash)
}
async function command(body: string): Promise<string> {
  const path = join(root, 'hdiffz')
  await writeFile(path, `#!${process.execPath}\n${body}\n`, { mode: 0o700 })
  return path
}
function uint(value: number): number[] {
  const bytes = [value % 128]
  while ((value = Math.floor(value / 128)) > 0) bytes.unshift(value % 128 | 128)
  return bytes
}
function fullCover(size: number): Buffer {
  const cover = [0, 0, ...uint(size)]
  return Buffer.from([...Buffer.from('HDIFF13&\0'), ...uint(size), ...uint(size), 1, ...uint(cover.length), 0, 0, 0, 0, 0, 0, 0, ...cover])
}
const version = "if (process.argv[2] === '-v') { console.log('HDiffPatch::hdiffz v4.12.0'); process.exit(0) }"

it('auto missing uses builtin through deltaText while explicit missing is visible and builtin needs no command', async () => {
  const missing = join(root, 'missing-hdiffz')
  const filesystem = new UserFileFilesystem(4096, 4096, { ...defaultDeltaPolicy, hdiffpatchCommand: missing })
  owners.push(filesystem)
  const path = join(root, 'file')
  await writeFile(path, 'a\nb\nc')
  await filesystem.readText(path, signal)
  await writeFile(path, 'a\ninsert\nb\nc\n')
  const delta = await filesystem.deltaText(path, await hash('a\nb\nc'), signal)
  expect(delta.kind).toBe('patch')
  if (delta.kind !== 'patch') throw new Error('expected patch')
  expect(await applyTextPatches('a\nb\nc', delta.ranges, hash)).toBe('a\ninsert\nb\nc\n')
  expect(await apply('a', await backend(missing, 'builtin').diff('a', 'b', signal))).toBe('b')
  await expect(backend(missing, 'hdiffpatch').diff('a', 'b', signal)).rejects.toMatchObject({ name: 'NativeDiffError', incompatible: true })
  expect(() => Config({ diffBackend: 'other' })).toThrow()
  expect(() => Config({ hdiffpatchCommand: '  ' })).toThrow()
})

it.skipIf(process.platform === 'win32')('caches incompatible auto commands before snapshot I/O and rejects explicit incompatibility', async () => {
  const executable = await command("console.log('another program')")
  const automatic = backend(executable, 'auto')
  expect(await apply('a', await automatic.diff('a', 'b', signal))).toBe('b')
  await writeFile(executable, `#!${process.execPath}\nprocess.exit(2)\n`, { mode: 0o700 })
  expect(await apply('a', await automatic.diff('a', 'c', signal))).toBe('c')
  await command("console.log('another program')")
  await expect(backend(executable, 'hdiffpatch').diff('a', 'b', signal)).rejects.toMatchObject({ incompatible: true })
})

it.skipIf(process.platform === 'win32')('validates equal whole lines inside additive covers and bounds malformed output and edit work', async () => {
  const base = 'α\nold\nkeep\ntail'
  const local = 'α\nNEW\nkeep\ntail'
  const data = fullCover(Buffer.byteLength(base))
  const executable = await command(`${version}\nrequire('node:fs').writeFileSync(process.argv.at(-1), Buffer.from('${data.toString('hex')}', 'hex'))`)
  const changes = await backend(executable, 'hdiffpatch').diff(base, local, signal)
  expect(changes).toEqual([{ startLine: 1, lineCount: 1, oldText: 'old\n', replacement: 'NEW\n' }])
  expect(await apply(base, changes)).toBe(local)
  expect(await backend(executable, 'hdiffpatch', { deltaMaxEditLength: 1 }).diff(base, local, signal)).toBeUndefined()
  expect(await backend(executable, 'hdiffpatch', { maxDeltaBytes: 1 }).diff(base, local, signal)).toBeUndefined()
  for (const invalid of [Buffer.from('HDIFFSF20&\0'), data.subarray(0, data.length - 1), fullCover(999)]) {
    expect(() => readHdiffCovers(invalid, Buffer.byteLength(base), Buffer.byteLength(local), () => {})).toThrow('HDIFF13')
  }
  await command(`${version}\nprocess.exit(2)`)
  await expect(backend(executable, 'auto').diff(base, local, signal)).rejects.toMatchObject({ incompatible: false })
})

it.skipIf(process.platform === 'win32')('abort awaits native exit and removes private snapshots; disposal also settles active jobs', async () => {
  const marker = join(root, 'ready.json')
  const executable = await command(`${version}\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ pid: process.pid, directory: require('node:path').dirname(process.argv.at(-1)) }))\nsetInterval(() => {}, 1000)`)
  for (const dispose of [false, true]) {
    const owner = backend(executable, 'hdiffpatch', { deltaDiffTimeoutMs: 30000 })
    const controller = new AbortController()
    const job = owner.diff('a', 'bb', controller.signal)
    const outcome = job.catch(error => error)
    let ready: { pid: number; directory: string } | undefined
    try {
      await vi.waitFor(async () => { ready = JSON.parse(await readFile(marker, 'utf8')); expect(ready).toBeDefined() })
      if (dispose) await owner.dispose()
      else controller.abort()
      expect(await outcome).toMatchObject({ name: 'AbortError' })
      expect(() => process.kill(ready!.pid, 0)).toThrow()
      await expect(stat(ready!.directory)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      controller.abort()
      await owner.dispose()
      await rm(marker, { force: true })
    }
  }
})

it.runIf(Boolean(process.env.DSH_HDIFFPATCH_TEST_COMMAND))('round-trips cross-line insertions and deletions through an actual optional hdiffz', async () => {
  const base = Array.from({ length: 30 }, (_, i) => `line ${i}: unchanged text 中文\n`).join('')
  const local = base.replace('line 5: unchanged text 中文\n', 'inserted one\ninserted two\n')
    .replace('line 20: unchanged text 中文\n', '') + 'terminal'
  const changes = await backend(process.env.DSH_HDIFFPATCH_TEST_COMMAND!, 'hdiffpatch').diff(base, local, signal)
  expect(changes!.length).toBeGreaterThan(1)
  expect(await apply(base, changes)).toBe(local)
})
