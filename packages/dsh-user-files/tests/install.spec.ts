import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { planUserFilesInstall, assertUserFilesRemovable } from '../src/install.ts'

it('reuses one compatible provider and rejects incompatible consumers or removal with remaining consumers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-provider-install-'))
  const name = '@dsh-external/dsh-user-files'
  const consumer = '@example/consumer'
  const manifest = async (path: string, value: unknown) => {
    await mkdir(path, { recursive: true })
    await writeFile(join(path, 'package.json'), JSON.stringify(value))
  }
  try {
    expect(planUserFilesInstall({ profileDirectory: root })).toHaveLength(1)
    await manifest(root, { dependencies: { [name]: '^0.1.0', [consumer]: '^2.0.0' }, dsh: { profile: { bundles: [name] } } })
    await manifest(join(root, 'node_modules', name), { name, version: '0.1.5' })
    await manifest(join(root, 'node_modules', consumer), { name: consumer, version: '2.7.0', peerDependencies: { [name]: '^0.1.0' } })
    expect(planUserFilesInstall({ profileDirectory: root })).toEqual([])
    expect(() => assertUserFilesRemovable({ profileDirectory: root })).toThrow(consumer)
    await manifest(join(root, 'node_modules', consumer), { name: consumer, peerDependencies: { [name]: '^0.2.0' } })
    expect(() => planUserFilesInstall({ profileDirectory: root })).toThrow('0.2.0')
    await manifest(root, { dependencies: { [name]: '^0.1.0' }, dsh: { profile: { bundles: [name, name] } } })
    expect(() => planUserFilesInstall({ profileDirectory: root })).toThrow('exactly one Bundle')
    assertUserFilesRemovable({ profileDirectory: root })
  } finally { await rm(root, { recursive: true, force: true }) }
})
