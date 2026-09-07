/** Canonical LF line changes shared by Host delta generation and browser patch consumers. */
import { diffArrays } from 'diff'
import type { UserFileTextPatch } from './types.ts'

/** An original-coordinate range ready for hashing into a UserFileTextPatch. */
export interface TextLineChange {
  readonly startLine: number
  readonly lineCount: number
  readonly oldText: string
  readonly replacement: string
}

/** Optional jsdiff computation limits; exhaustion returns undefined. */
export interface TextLineDiffOptions {
  readonly timeout?: number
  readonly maxEditLength?: number
}

/** A malformed patch or a range whose content precondition failed. */
export class TextPatchError extends Error {
  /** @param code Failure category shared with the filesystem owner. @param message Diagnostic. */
  constructor(readonly code: 'invalid-request' | 'stale-version', message: string) {
    super(message)
    this.name = 'TextPatchError'
  }
}

/** @param text Canonical LF text. @returns Tokens retaining final LF, with no phantom trailing token. */
export function textLineTokens(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? []
}

/** Line-aligned middle texts with one retained insertion neighbor and original line offset. */
export interface TextLineCrop {
  readonly base: string
  readonly local: string
  readonly startLine: number
}

/**
 * Remove equal outer lines before either backend tokenizes or writes native snapshots.
 * @param base Canonical original text. @param local Canonical replacement text.
 * @param check Cooperative budget checkpoint; false stops scanning, exceptions propagate.
 * @returns Middle texts and their original line offset, or undefined on budget exhaustion.
 */
export function cropTextLines(base: string, local: string, check: () => boolean): TextLineCrop | undefined {
  // Bound each equality comparison and newline search, including documents with very long lines.
  const chunkSize = 4096
  let prefix = 0
  let lineStart = 0
  let previousLineStart = 0
  let lines = 0
  const limit = Math.min(base.length, local.length)
  while (prefix < limit) {
    if (!check()) return undefined
    const end = Math.min(prefix + chunkSize, limit)
    const oldChunk = base.slice(prefix, end)
    const newChunk = local.slice(prefix, end)
    let equal = oldChunk.length
    if (oldChunk !== newChunk) {
      equal = 0
      while (equal < oldChunk.length && oldChunk[equal] === newChunk[equal]) equal++
    }
    for (let lf = oldChunk.indexOf('\n'); lf >= 0 && lf < equal; lf = oldChunk.indexOf('\n', lf + 1)) {
      previousLineStart = lineStart
      lineStart = prefix + lf + 1
      lines++
    }
    prefix += equal
    if (equal < oldChunk.length) break
  }
  if (!check()) return undefined
  if (prefix === base.length && prefix === local.length) return { base: '', local: '', startLine: 0 }

  let suffix = 0
  const suffixLimit = Math.min(base.length - lineStart, local.length - lineStart)
  while (suffix < suffixLimit) {
    if (!check()) return undefined
    const size = Math.min(chunkSize, suffixLimit - suffix)
    const oldChunk = base.slice(base.length - suffix - size, base.length - suffix)
    const newChunk = local.slice(local.length - suffix - size, local.length - suffix)
    let equal = size
    if (oldChunk !== newChunk) {
      equal = 0
      while (equal < size && oldChunk[size - equal - 1] === newChunk[size - equal - 1]) equal++
    }
    suffix += equal
    if (equal < size) break
  }
  let oldEnd = base.length - suffix
  let newEnd = local.length - suffix
  // A matching suffix may begin inside a line, at different offsets after an insertion.
  while (oldEnd < base.length && !((oldEnd === 0 || base[oldEnd - 1] === '\n')
    && (newEnd === 0 || local[newEnd - 1] === '\n'))) {
    if ((oldEnd & (chunkSize - 1)) === 0 && !check()) return undefined
    oldEnd++
    newEnd++
  }
  const start = lines > 0 ? previousLineStart : 0
  // At the beginning of a nonempty document, an insertion guards the following line.
  if (oldEnd === start && base.length > start) {
    do {
      if ((oldEnd & (chunkSize - 1)) === 0 && !check()) return undefined
      oldEnd++
      newEnd++
    } while (oldEnd < base.length && base[oldEnd - 1] !== '\n')
  }
  if (!check()) return undefined
  return { base: base.slice(start, oldEnd), local: local.slice(start, newEnd), startLine: Math.max(0, lines - 1) }
}

/**
 * Compute ordered, disjoint line changes, expanding pure insertions into neighboring context.
 * @param base Canonical original text. @param local Canonical replacement text. @param options Optional computation limits.
 * @returns Original-coordinate changes, or undefined when the diff budget is exhausted.
 */
export function diffTextLines(base: string, local: string, options: TextLineDiffOptions = {}): TextLineChange[] | undefined {
  const deadline = Date.now() + (options.timeout ?? Infinity)
  const middle = cropTextLines(base, local, () => Date.now() <= deadline)
  if (middle === undefined) return undefined
  const oldLines = textLineTokens(middle.base)
  const newLines = textLineTokens(middle.local)
  if (Date.now() > deadline) return undefined
  const changes = diffArrays(oldLines, newLines, { timeout: deadline - Date.now(),
    ...(options.maxEditLength === undefined ? {} : { maxEditLength: options.maxEditLength }) })
  if (changes === undefined || Date.now() > deadline) return undefined
  const ranges: TextLineRange[] = []
  let oldPosition = 0
  let newPosition = 0
  let pending: TextLineRange | undefined
  const flush = (): void => {
    if (pending !== undefined) ranges.push(pending)
    pending = undefined
  }
  for (const change of changes) {
    if (!change.added && !change.removed) {
      flush()
      oldPosition += change.value.length
      newPosition += change.value.length
    } else {
      pending ??= { oldFrom: oldPosition, oldTo: oldPosition, newFrom: newPosition, newTo: newPosition }
      if (change.removed) oldPosition += change.value.length
      if (change.added) newPosition += change.value.length
      pending.oldTo = oldPosition
      pending.newTo = newPosition
    }
  }
  flush()
  return materializeTextLineRanges(oldLines, newLines, ranges, middle.startLine)
}

/** Ordered original/replacement token coordinates, before insertion context expansion. */
export interface TextLineRange {
  oldFrom: number
  oldTo: number
  newFrom: number
  newTo: number
}

/**
 * Expand insertion context and merge adjacent ranges for both diff backends.
 * @param oldLines Original LF tokens. @param newLines Replacement LF tokens. @param changes Ordered disjoint changes.
 * @param startLine Original line offset of the supplied tokens.
 * @returns Hash-ready original-coordinate changes; input coordinates are not mutated.
 */
export function materializeTextLineRanges(
  oldLines: readonly string[], newLines: readonly string[], changes: readonly TextLineRange[], startLine = 0,
): TextLineChange[] {
  const ranges: TextLineRange[] = []
  for (const change of changes) {
    const pending = { ...change }
    if (pending.oldFrom === pending.oldTo && oldLines.length > 0) {
      if (pending.oldFrom > 0) { pending.oldFrom--; pending.newFrom-- }
      else { pending.oldTo++; pending.newTo++ }
    }
    const previous = ranges.at(-1)
    if (previous !== undefined && pending.oldFrom <= previous.oldTo) {
      previous.oldTo = Math.max(previous.oldTo, pending.oldTo)
      previous.newTo = Math.max(previous.newTo, pending.newTo)
    } else ranges.push(pending)
  }
  return ranges.map(range => ({
    startLine: startLine + range.oldFrom, lineCount: range.oldTo - range.oldFrom,
    oldText: oldLines.slice(range.oldFrom, range.oldTo).join(''),
    replacement: newLines.slice(range.newFrom, range.newTo).join(''),
  }))
}

/** @param ranges Wire patches. @returns A request-owned copy with valid hash spelling and canonical replacement text. */
export function prepareTextPatches(ranges: readonly UserFileTextPatch[]): readonly UserFileTextPatch[] {
  return ranges.map(range => {
    if (!/^[a-f\d]{64}$/u.test(range.expectedHash)
      || /[\r\0]/u.test(range.replacement) || !range.replacement.isWellFormed()) {
      throw new TextPatchError('invalid-request', 'text patches require lowercase SHA-256 hashes and well-formed canonical LF text')
    }
    return { ...range }
  })
}

/**
 * Check all prepared patches against one token snapshot before any application.
 * @param lines Canonical original tokens. @param ranges Prepared patches. @param hashText Canonical text SHA-256.
 * @returns Completion after every range matches; rejects malformed coordinates and conflicts.
 */
export async function validateTextPatchRanges(
  lines: readonly string[], ranges: readonly UserFileTextPatch[], hashText: (text: string) => Promise<string>,
): Promise<void> {
  let end = 0
  for (const range of ranges) {
    const emptyInsertion = lines.length === 0 && ranges.length === 1 && range.startLine === 0 && range.lineCount === 0
    if (!Number.isSafeInteger(range.startLine) || !Number.isSafeInteger(range.lineCount)
      || range.startLine < end || range.lineCount < 0 || (range.lineCount === 0 && !emptyInsertion)
      || range.startLine + range.lineCount > lines.length
      || await hashText(lines.slice(range.startLine, range.startLine + range.lineCount).join('')) !== range.expectedHash) {
      throw new TextPatchError('stale-version', 'text patch range no longer matches')
    }
    end = range.startLine + range.lineCount
  }
}

/**
 * Apply wire patches only after all original-coordinate hashes and range relationships match.
 * @param text Canonical original text. @param ranges Wire patches. @param hashText Canonical text SHA-256.
 * @returns Canonical output; rejects malformed patches or conflicts without partial output.
 */
export async function applyTextPatches(
  text: string, ranges: readonly UserFileTextPatch[], hashText: (text: string) => Promise<string>,
): Promise<string> {
  const patches = prepareTextPatches(ranges)
  const lines = textLineTokens(text)
  await validateTextPatchRanges(lines, patches, hashText)
  const output: string[] = []
  let position = 0
  for (const range of patches) {
    output.push(lines.slice(position, range.startLine).join(''), range.replacement)
    position = range.startLine + range.lineCount
  }
  output.push(lines.slice(position).join(''))
  return output.join('')
}
