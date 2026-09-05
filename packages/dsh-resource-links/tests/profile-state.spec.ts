import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'

it('distinguishes absent profiles from Bundle-only ghosts and wrong checkout declarations', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-resource-links-profile-'))
  const script = fileURLToPath(new URL('../../../scripts/profile-state.mjs', import.meta.url))
  const checkout = fileURLToPath(new URL('../../../harness', import.meta.url))
  const root = join(home, 'profiles', 'test')
  const name = '@dsh-external/dsh-resource-links'
  const run = (mode: string) => spawnSync(process.execPath, [script, mode], {
    encoding: 'utf8', env: { ...process.env, DSH_CHECKOUT: checkout, DSH_HOME: home, DSH_PROFILE: 'test' },
  })
  try {
    const absent = run('--check')
    expect(absent.status).toBe(0)
    expect(absent.stdout).toContain('profile is absent')
    expect(run('--verify').status).toBe(1)
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: [name] } } }))
    const ghost = run('--check')
    expect(ghost.status).toBe(1)
    expect(ghost.stderr).toContain('Mixed profile state')
    await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { [name]: 'link:/wrong-checkout' }, dsh: { profile: { bundles: [name] } } }))
    const wrong = run('--verify')
    expect(wrong.status).toBe(1)
    expect(wrong.stderr).toContain('manifest/lock specifier')
    expect(run('--removed').status).toBe(1)
  } finally { await rm(home, { recursive: true, force: true }) }
})
