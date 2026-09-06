import { describe, expect, it } from 'vitest'
import { candidates, filesystemTarget } from '../src/client/parse.ts'

describe('resource candidate recognition', () => {
  it.each(['/', '.', '..', '/root/文档/a(b).md:12:3', './src/app.ts', '../notes', 'src/你好.md', 'README.md', 'src', '/root/my notes/a.md'])('retains the complete inline-code path %s', text => {
    expect(candidates(text, 'inline-code', 20)).toEqual([{ start: 0, end: text.length, target: text }])
    expect(candidates(text, 'text', 20)).toEqual([])
    expect(candidates(text, 'target', 20)).toEqual([])
  })

  it('preserves source positions, local file URLs, and path punctuation', () => {
    expect(filesystemTarget('/root/文档/a(b).md:12:3')).toBe('/root/文档/a(b).md')
    expect(filesystemTarget('/root/a.md#L10-L20')).toBe('/root/a.md')
    expect(filesystemTarget('/root/@scope/my-file_(2).ts')).toBe('/root/@scope/my-file_(2).ts')
    expect(filesystemTarget('file:///root/my%20notes/a.md#L2')).toBe('/root/my notes/a.md')
    expect(filesystemTarget('file://localhost/root/a.md')).toBe('/root/a.md')
  })

  it('leaves bare, quoted and backtick-containing prose paths inert', () => {
    for (const text of ['`write` / `edit`', 'See "/root/my notes/a.md".', '`/`', '\\`/\\`', '`/ unmatched', '😀 (/root/a.md), ./src/app.ts README.md。']) {
      expect(candidates(text, 'text', 20), text).toEqual([])
    }
  })

  it('never extracts filesystem suffixes from unsupported URLs or email', () => {
    for (const value of ['file://remote/root/a.md', 'file:///a?secret', 'file:///bad%XX', 'https://a/path', '//server/path', 'user@example.com']) {
      expect(candidates(value, 'inline-code', 20), value).toEqual([])
    }
    expect(filesystemTarget('ordinary', false)).toBeUndefined()
  })

  it('recognizes explicit references as ordered UTF-16 ranges with display labels', () => {
    const text = '😀 @[Other session](dsh-session:session-2) and dsh-session:session-3'
    const found = candidates(text, 'text', 10)
    expect(found).toEqual([
      { start: 3, end: 42, target: 'dsh-session:session-2', label: 'Other session' },
      { start: 47, end: text.length, target: 'dsh-session:session-3' },
    ])
    expect(candidates(text, 'text', 1)).toEqual(found.slice(0, 1))
    for (const mode of ['text', 'inline-code', 'target'] as const) {
      expect(candidates('dsh-session:session-2', mode, 1)).toHaveLength(1)
      expect(candidates('dsh-session:session-2', mode, 0)).toEqual([])
    }
  })
})
