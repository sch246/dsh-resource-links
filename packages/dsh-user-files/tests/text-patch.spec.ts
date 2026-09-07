import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { applyTextPatches, cropTextLines, diffTextLines } from '../src/text-patch.ts'

const hash = async (text: string): Promise<string> => createHash('sha256').update(text).digest('hex')

it('guards an insertion after a long prefix and removes the exact shifted suffix before tokenization', async () => {
  const prefix = '相同🙂\n'.repeat(10000)
  const suffix = 'unchanged\n'.repeat(10000) + '尾部'
  const base = prefix + 'guard\n' + suffix
  const local = prefix + 'guard\ninserted\n' + suffix
  expect(cropTextLines(base, local, () => true)).toEqual({ base: 'guard\n', local: 'guard\ninserted\n', startLine: 10000 })
  const changes = diffTextLines(base, local)!
  expect(changes).toEqual([{ startLine: 10000, lineCount: 1, oldText: 'guard\n', replacement: 'guard\ninserted\n' }])
  const patches = await Promise.all(changes.map(async change => ({ ...change, expectedHash: await hash(change.oldText) })))
  expect(await applyTextPatches(base, patches, hash)).toBe(local)
  await expect(applyTextPatches(prefix + 'external\n' + suffix, patches, hash)).rejects.toMatchObject({ code: 'stale-version' })
})

it('reconstructs empty documents, append/delete, partial Unicode lines and unterminated suffixes', async () => {
  for (const [base, local] of [
    ['', '🙂\n'], ['🙂\n', ''], ['a\n', 'a\n🙂'], ['a\n🙂', 'a\n'],
    ['a\n尾部', 'a\n新增\n尾部'], ['尾部', '新增\n尾部'], ['🙂尾部', '🙃尾部'],
    ['a\nb\n', 'a\nxb\n'], ['a\n', 'a'], ['same\n', 'same\n'],
  ] as const) {
    const changes = diffTextLines(base, local)!
    const patches = await Promise.all(changes.map(async change => ({ ...change, expectedHash: await hash(change.oldText) })))
    expect(await applyTextPatches(base, patches, hash)).toBe(local)
    expect(changes.every(change => change.lineCount > 0 || base === '')).toBe(true)
  }
})

it('checks scan budgets within long lines in either equal edge', () => {
  const edge = 'x'.repeat(20000)
  for (const [base, local] of [[edge + 'a', edge + 'b'], ['a' + edge, 'b' + edge]]) {
    let checks = 0
    expect(cropTextLines(base!, local!, () => ++checks < 3)).toBeUndefined()
    expect(checks).toBe(3)
  }
  expect(diffTextLines('a', 'b', { timeout: -1 })).toBeUndefined()
})
