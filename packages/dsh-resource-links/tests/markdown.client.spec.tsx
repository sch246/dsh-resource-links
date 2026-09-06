// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { MarkdownText } from '../../../../harness/packages/client/ui-primitives/src/markdown/MarkdownText.tsx'
import { ResourceLinksRuntime, type Gateway } from '../src/client/runtime.ts'

const sessionId = 'session-1' as SessionId
const other = 'session-2' as SessionId
const runtimes: ResourceLinksRuntime[] = []
afterEach(async () => {
  cleanup()
  await Promise.all(runtimes.splice(0).map(runtime => runtime.dispose()))
})

describe('resource links through Host Markdown rendering', () => {
  it('discovers only parsed inline code and keeps explicit session navigation and HTTP links', async () => {
    const gateway: Gateway = {
      cwd: () => '/workspace', knownSession: id => id === sessionId || id === other,
      resolveMany: vi.fn(async (_id, paths) => paths.map(inputPath => ['/', '.', './src/a.md'].includes(inputPath)
        ? { inputPath, ok: true as const, value: { path: inputPath, name: inputPath, kind: inputPath.endsWith('.md') ? 'file' as const : 'directory' as const } }
        : { inputPath, ok: false as const, error: { code: 'ENOENT', message: 'Not found' } })),
      resolve: vi.fn(async (_id, path) => ({ path, name: path, kind: 'directory' as const })),
      openResource: vi.fn(async () => {}), openDirectory: vi.fn(async () => {}),
      openSession: vi.fn(), openSystem: vi.fn(async () => {}),
    }
    const runtime = new ResourceLinksRuntime(gateway, {
      openMode: 'preview', batchDelayMs: 0, maxBatchSize: 128, cacheTtlMs: 1000,
      maxCacheEntries: 128, maxPendingPaths: 128, maxCandidatesPerText: 32,
    })
    runtimes.push(runtime)
    const resolve = vi.fn((text: string, mode: Parameters<ResourceLinksRuntime['resolve']>[2]) => runtime.resolve(sessionId, text, mode))
    const source = [
      '`write` / `edit`', '`/` `.` `./src/a.md` `/missing`',
      '\\`/\\`', '`/ unmatched', '```text\n/ . ./src/a.md\n```',
      '[root](/) [current](.) [web](https://example.com/path.md)',
      '[Other session](dsh-session:session-2) dsh-session:session-2 `dsh-session:session-2`',
    ].join('\n\n')
    const view = render(<MarkdownText text={source}
      labels={{ code: { copyLabel: 'Copy', copiedLabel: 'Copied' }, footnotes: 'Footnotes' }}
      textLinks={{ resolve, open: target => { void runtime.open(sessionId, target) } }} />)
    await screen.findByRole('button', { name: './src/a.md' })
    expect(view.container.querySelector('p')?.textContent).toBe('write / edit')
    expect(view.container.querySelector('p')?.querySelector('button')).toBeNull()
    expect([...view.container.querySelectorAll('code button')].map(node => node.textContent))
      .toEqual(['/', '.', './src/a.md', 'dsh-session:session-2'])
    expect(resolve.mock.calls.filter(([, mode]) => mode === 'inline-code').map(([text]) => text))
      .toEqual(['write', 'edit', '/', '.', './src/a.md', '/missing', 'dsh-session:session-2'])
    expect(vi.mocked(gateway.resolveMany).mock.calls.flatMap(([, paths]) => paths))
      .toEqual(['write', 'edit', '/', '.', './src/a.md', '/missing'])
    expect(screen.queryByRole('button', { name: 'root' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'current' })).toBeNull()
    expect(screen.getByRole('link', { name: 'web' }).getAttribute('href')).toBe('https://example.com/path.md')
    fireEvent.click(screen.getByRole('button', { name: 'Other session' }))
    expect(gateway.openSession).toHaveBeenCalledWith(other)
    expect(gateway.resolve).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '/' }))
    fireEvent.click(screen.getByRole('button', { name: '.' }))
    await waitFor(() => { expect(gateway.openDirectory).toHaveBeenCalledTimes(2) })
    expect(vi.mocked(gateway.openDirectory).mock.calls).toEqual([[sessionId, '/'], [sessionId, '.']])
    expect(gateway.openSystem).not.toHaveBeenCalled()
  })
})
