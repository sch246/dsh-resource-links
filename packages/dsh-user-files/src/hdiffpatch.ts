/** Optional Host-only HDIFF13 cover adapter; browser patches remain canonical line ranges. */
import { spawn } from 'node:child_process'
import { watch, type FSWatcher } from 'node:fs'
import { mkdtemp, open, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { diffTextLines, materializeTextLineRanges, textLineTokens } from './text-patch.ts'
import type { TextLineChange, TextLineRange } from './text-patch.ts'
import type { UserFileDeltaPolicy } from './types.ts'

/** Native command/configuration failures that must remain visible to callers. */
export class NativeDiffError extends Error {
  /** @param message Diagnostic. @param incompatible Whether auto mode may select builtin. @param options Underlying cause. */
  constructor(message: string, readonly incompatible = false, options?: ErrorOptions) {
    super(message, options)
    this.name = 'NativeDiffError'
  }
}
class DiffBudgetError extends Error {}

interface Cover { old: number; next: number; length: number }

/**
 * Read uncompressed HDIFF13 covers, without applying additive data or trusting covers as equal bytes.
 * Format reference: HDiffPatch v4.12.0, patch.c read_diffz_head, _covers_read_cover and hpatch_unpackUIntWithTag.
 * https://github.com/sisong/HDiffPatch/blob/d65858b844bbb98450a5e86feb8c2992bf00d8e6/libHDiffPatch/HPatch/patch.c
 * @param data Bounded native output. @param oldSize Original bytes. @param newSize Replacement bytes.
 * @param check Cancellation/deadline checkpoint. @returns Validated byte covers in new-file order.
 */
export function readHdiffCovers(data: Buffer, oldSize: number, newSize: number, check: () => void): Cover[] {
  const invalid = (): never => { throw new NativeDiffError('hdiffz requires uncompressed HDIFF13 output', true) }
  if (!data.subarray(0, 9).equals(Buffer.from('HDIFF13&\0'))) invalid()
  let position = 9
  let end = data.length
  const uint = (tagBits = 0): number => {
    if (position >= end) return invalid()
    let byte = data[position++]!
    let value = byte & (127 >> tagBits)
    let more = (byte & (128 >> tagBits)) !== 0
    while (more) {
      if (position >= end) return invalid()
      byte = data[position++]!
      value = value * 128 + (byte & 127)
      if (!Number.isSafeInteger(value)) return invalid()
      more = (byte & 128) !== 0
    }
    return value
  }
  if (uint() !== newSize || uint() !== oldSize) invalid()
  const count = uint()
  const sections: number[] = []
  for (let i = 0; i < 4; i++) {
    sections.push(uint())
    if (uint() !== 0) invalid()
  }
  if (sections.reduce((total, size) => total + size, position) !== data.length) invalid()
  end = position + sections[0]!
  if (count > sections[0]! / 3) invalid()
  const covers: Cover[] = []
  let oldEnd = 0
  let newEnd = 0
  for (let i = 0; i < count; i++) {
    check()
    const negative = (data[position]! & 128) !== 0
    const offset = uint(1)
    const old = oldEnd + (negative ? -offset : offset)
    const next = newEnd + uint()
    const length = uint()
    if (old < 0 || old > oldSize || length > oldSize - old || next > newSize || length > newSize - next) invalid()
    covers.push({ old, next, length })
    oldEnd = old + length
    newEnd = next + length
  }
  if (position !== end) invalid()
  return covers
}

function lineChanges(base: string, local: string, covers: readonly Cover[], maxEdits: number, check: () => void): TextLineChange[] {
  const oldLines = textLineTokens(base)
  const newLines = textLineTokens(local)
  check()
  const oldStarts = new Map<number, number>()
  let offset = 0
  for (let i = 0; i < oldLines.length; i++) {
    check()
    oldStarts.set(offset, i)
    offset += Buffer.byteLength(oldLines[i]!)
  }
  const ranges: TextLineRange[] = []
  let oldFrom = 0
  let newFrom = 0
  let newOffset = 0
  let coverIndex = 0
  let edits = 0
  const gap = (oldTo: number, newTo: number): void => {
    if (oldTo === oldFrom && newTo === newFrom) return
    edits += oldTo - oldFrom + newTo - newFrom
    if (edits > maxEdits) throw new DiffBudgetError()
    ranges.push({ oldFrom, oldTo, newFrom, newTo })
  }
  for (let i = 0; i < newLines.length; i++) {
    check()
    const line = newLines[i]!
    const end = newOffset + Buffer.byteLength(line)
    while (coverIndex < covers.length && covers[coverIndex]!.next + covers[coverIndex]!.length <= newOffset) coverIndex++
    const cover = covers[coverIndex]
    if (cover !== undefined && cover.next <= newOffset && cover.next + cover.length >= end) {
      const oldLine = oldStarts.get(cover.old + newOffset - cover.next)
      // HDIFF13 covers can contain additive changes and backward copies; only equal monotonic lines are anchors.
      if (oldLine !== undefined && oldLine >= oldFrom && oldLines[oldLine] === line) {
        gap(oldLine, i)
        oldFrom = oldLine + 1
        newFrom = i + 1
      }
    }
    newOffset = end
  }
  gap(oldLines.length, newLines.length)
  check()
  const changes = materializeTextLineRanges(oldLines, newLines, ranges)
  check()
  return changes
}

async function runCommand(command: string, args: string[], maxBytes: number, signal: AbortSignal, directory?: string): Promise<string> {
  signal.throwIfAborted()
  return await new Promise<string>((resolve, reject) => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/KEY|SECRET|TOKEN|PASSWORD/i.test(key)))
    const child = spawn(command, args,
      { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let failure: Error | undefined
    const output: Buffer[] = []
    let observedBytes = 0
    let checking: Promise<void> | undefined
    const stop = (error: Error): void => { failure ??= error; child.kill('SIGKILL') }
    const onAbort = (): void => { stop(signal.reason as Error) }
    const onData = (chunk: Buffer): void => {
      observedBytes += chunk.length
      if (observedBytes > maxBytes) stop(new DiffBudgetError())
    }
    child.stdout.on('data', (chunk: Buffer) => {
      onData(chunk)
      if (directory === undefined && observedBytes <= maxBytes) output.push(chunk)
    })
    child.stderr.on('data', onData)
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
    let watcher: FSWatcher | undefined
    if (directory !== undefined) {
      try {
        watcher = watch(directory, () => {
          checking ??= stat(join(directory, 'diff')).then(info => {
            if (info.size > maxBytes) stop(new DiffBudgetError())
          }, (error: NodeJS.ErrnoException) => {
            if (error.code !== 'ENOENT') stop(new NativeDiffError('cannot inspect hdiffz output', false, { cause: error }))
          }).finally(() => { checking = undefined })
        })
        watcher.on('error', error => stop(new NativeDiffError('cannot watch hdiffz output', false, { cause: error })))
      } catch (error) {
        stop(new NativeDiffError('cannot watch hdiffz output', false, { cause: error }))
      }
    }
    child.on('error', (error: NodeJS.ErrnoException) => {
      failure ??= new NativeDiffError(`hdiffz command unavailable: ${command}`, error.code === 'ENOENT' || error.code === 'ENOEXEC', { cause: error })
    })
    child.on('close', (code, exitSignal) => {
      watcher?.close()
      signal.removeEventListener('abort', onAbort)
      void Promise.resolve(checking).then(() => {
        if (failure !== undefined) reject(failure)
        else if (code !== 0) reject(new NativeDiffError(`hdiffz failed (exit ${code}, signal ${exitSignal})`, code === 1))
        else resolve(Buffer.concat(output).toString('utf8'))
      })
    })
  })
}

/** Provider-owned backend selection and native job lifetime; no work admission queue. */
export class TextDeltaBackend {
  readonly #controller = new AbortController()
  readonly #jobs = new Set<Promise<TextLineChange[] | undefined>>()
  readonly #mode: 'auto' | 'builtin' | 'hdiffpatch'
  readonly #command: string
  #available: boolean | undefined

  /** @param policy Provider delta budgets and optional native selection. */
  constructor(private readonly policy: UserFileDeltaPolicy) {
    this.#mode = policy.diffBackend ?? 'auto'
    this.#command = policy.hdiffpatchCommand ?? 'hdiffz'
  }

  /** @param base Canonical baseline. @param local Current canonical content. @param signal Cancellation. @returns Line changes or exhausted budget. */
  diff(base: string, local: string, signal: AbortSignal): Promise<TextLineChange[] | undefined> {
    const job = this.#diff(base, local, AbortSignal.any([signal, this.#controller.signal]))
    this.#jobs.add(job)
    void job.then(() => this.#jobs.delete(job), () => this.#jobs.delete(job))
    return job
  }

  /** Abort native jobs and await their exit and temporary-file cleanup. */
  async dispose(): Promise<void> {
    this.#controller.abort()
    await Promise.allSettled(this.#jobs)
  }

  async #diff(base: string, local: string, signal: AbortSignal): Promise<TextLineChange[] | undefined> {
    if (this.#mode !== 'builtin' && this.#available === undefined) {
      const budget = new AbortController()
      const timer = setTimeout(() => budget.abort(new DiffBudgetError()), Math.min(this.policy.deltaDiffTimeoutMs, 2147483647))
      try {
        const version = await runCommand(this.#command, ['-v'], 4096, AbortSignal.any([signal, budget.signal]))
        if (!/^HDiffPatch::hdiffz v[0-9]+\.[0-9]+/mu.test(version)) {
          throw new NativeDiffError('configured command is not a compatible hdiffz executable', true)
        }
        this.#available = true
      } catch (error) {
        signal.throwIfAborted()
        if (error instanceof DiffBudgetError || budget.signal.aborted) return undefined
        if (!(error instanceof NativeDiffError) || !error.incompatible || this.#mode !== 'auto') throw error
        this.#available = false
      } finally { clearTimeout(timer) }
    }
    return await this.#compute(base, local, signal)
  }

  async #compute(base: string, local: string, signal: AbortSignal): Promise<TextLineChange[] | undefined> {
    const deadline = performance.now() + this.policy.deltaDiffTimeoutMs
    const check = (): void => {
      signal.throwIfAborted()
      if (performance.now() >= deadline) throw new DiffBudgetError()
    }
    const builtin = (): TextLineChange[] | undefined => diffTextLines(base, local, {
      timeout: Math.max(0, deadline - performance.now()), maxEditLength: this.policy.deltaMaxEditLength,
    })
    let directory: string | undefined
    const budget = new AbortController()
    const timer = setTimeout(() => budget.abort(new DiffBudgetError()), Math.min(this.policy.deltaDiffTimeoutMs, 2147483647))
    const jobSignal = AbortSignal.any([signal, budget.signal])
    try {
      check()
      if (this.#mode === 'builtin' || this.#available === false) return builtin()
      directory = await mkdtemp(join(tmpdir(), 'dsh-hdiff-'))
      check()
      await writeFile(join(directory, 'old'), base, { flag: 'wx', mode: 0o600, signal: jobSignal })
      await writeFile(join(directory, 'new'), local, { flag: 'wx', mode: 0o600, signal: jobSignal })
      check()
      await runCommand(this.#command, ['-d', join(directory, 'old'), join(directory, 'new'), join(directory, 'diff')], this.policy.maxDeltaBytes, jobSignal, directory)
      check()
      let handle
      try { handle = await open(join(directory, 'diff'), 'r') } catch (error) {
        throw new NativeDiffError('cannot open hdiffz output', (error as NodeJS.ErrnoException).code === 'ENOENT', { cause: error })
      }
      let data: Buffer
      try {
        const info = await handle.stat()
        if (!info.isFile() || info.size > this.policy.maxDeltaBytes) throw new DiffBudgetError()
        // Read at most the accepted stat size, even if an incompatible command left a writer behind.
        data = Buffer.alloc(info.size)
        let offset = 0
        while (offset < data.length) {
          check()
          const result = await handle.read(data, offset, data.length - offset, offset)
          if (result.bytesRead === 0) throw new NativeDiffError('hdiffz output was truncated', true)
          offset += result.bytesRead
        }
      } finally { await handle.close() }
      const covers = readHdiffCovers(data, Buffer.byteLength(base), Buffer.byteLength(local), check)
      return lineChanges(base, local, covers, this.policy.deltaMaxEditLength, check)
    } catch (error) {
      signal.throwIfAborted()
      if (error instanceof DiffBudgetError || budget.signal.aborted) return undefined
      if (error instanceof NativeDiffError && error.incompatible && this.#mode === 'auto') {
        this.#available = false
        return performance.now() >= deadline ? undefined : builtin()
      }
      throw error
    } finally {
      clearTimeout(timer)
      if (directory !== undefined) await rm(directory, { recursive: true, force: true })
    }
  }
}
