import { describe, expect, it } from 'vitest'
import { candidates, filesystemTarget } from '../src/client/parse.ts'

describe('resource candidate recognition', () => {
  it('retains Unicode UTF-16 ranges, filename punctuation and source positions', () => {
    const text = '😀 (/root/文档/a(b).md:12:3), ./src/app.ts ../notes src/你好.md README.md。'
    const found = candidates(text, 'text', 20)
    expect(found.map(item => text.slice(item.start, item.end))).toEqual([
      '/root/文档/a(b).md:12:3', './src/app.ts', '../notes', 'src/你好.md', 'README.md',
    ])
    expect(filesystemTarget(found[0]!.target)).toBe('/root/文档/a(b).md')
    expect(filesystemTarget('/root/a.md#L10-L20')).toBe('/root/a.md')
    expect(filesystemTarget('/root/@scope/my-file_(2).ts')).toBe('/root/@scope/my-file_(2).ts')
  })

  it('accepts whole destinations and quoted paths containing spaces', () => {
    expect(candidates('/root/my notes/a.md', 'target', 2)).toEqual([{ start: 0, end: 19, target: '/root/my notes/a.md' }])
    expect(candidates('See "/root/my notes/a.md".', 'text', 2)[0]?.target).toBe('/root/my notes/a.md')
    expect(filesystemTarget('file:///root/my%20notes/a.md#L2')).toBe('/root/my notes/a.md')
    expect(filesystemTarget('file://localhost/root/a.md')).toBe('/root/a.md')
  })

  it('never extracts filesystem suffixes from unsupported URLs or email', () => {
    const text = 'https://a.com/path.md http://x/a mailto:x@y.com user@example.com ftp://a/file.md data:text/plain ./real.md'
    expect(candidates(text, 'text', 20).map(item => item.target)).toEqual(['./real.md'])
    for (const value of ['file://remote/root/a.md', 'file:///a?secret', 'file:///bad%XX', 'https://a/path', '//server/path', 'ordinary']) {
      expect(filesystemTarget(value, false), value).toBeUndefined()
    }
  })

  it('recognizes explicit references as one range with their display label', () => {
    const text = '@[Other session](dsh-session:session-2) and dsh-session:session-3'
    expect(candidates(text, 'text', 10)).toEqual([
      { start: 0, end: 39, target: 'dsh-session:session-2', label: 'Other session' },
      { start: 44, end: text.length, target: 'dsh-session:session-3' },
    ])
    expect(candidates('one.md two.md three.md', 'text', 2)).toHaveLength(2)
    expect(candidates('src', 'target', 1)).toEqual([{ start: 0, end: 3, target: 'src' }])
    expect(candidates('src ordinary words', 'text', 5)).toEqual([])
  })
})
