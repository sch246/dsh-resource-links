import { readFileSync, realpathSync, existsSync, lstatSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { removeOwnedLink } from './removed-link.mjs'

const checkout = process.env.DSH_CHECKOUT
const home = process.env.DSH_HOME
const profile = process.env.DSH_PROFILE
if (!checkout || !home || !profile) throw new Error('Set DSH_CHECKOUT, DSH_HOME and DSH_PROFILE explicitly')
const mode = process.argv[2] ?? '--check'
if (!['--check', '--verify', '--removed', '--remove-dependency', '--finish-removal', '--plan-install'].includes(mode)) throw new Error(`Unknown profile inspection mode: ${mode}`)
const name = '@dsh-external/dsh-user-files'
const target = realpathSync(join(import.meta.dirname, '../packages/dsh-user-files'))
const root = join(home, 'profiles', profile)
const manifestPath = join(root, 'package.json')
if (!existsSync(manifestPath)) {
  if (mode === '--verify') throw new Error('Profile manifest is absent')
  if (mode === '--plan-install') { console.log(target); process.exit(0) }
  console.log('Resource links is not installed; profile is absent.')
  process.exit(0)
}
const { planUserFilesInstall, assertUserFilesRemovable } = await import('../packages/dsh-user-files/lib/types/install.js')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const require = createRequire(join(checkout, 'apps/cli/package.json'))
const { load, DEFAULT_SCHEMA, Type } = require('js-yaml')
const schema = DEFAULT_SCHEMA.extend([new Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: value => value })])
function parse(text, subject) {
  try { return load(text, { schema }) }
  catch (error) { throw new Error(`Invalid YAML in ${subject}: ${error.reason ?? 'parse failure'}`) }
}
if (mode === '--plan-install') {
  if (manifest.dependencies?.['@dsh-external/dsh-resource-links']) throw new Error('Migrate the existing resource-links Bundle and complete configuration before installing user-files; see STATE')
  for (const path of planUserFilesInstall({ profileDirectory: root })) console.log(path)
  process.exit(0)
}
const lockPath = join(root, 'pnpm-lock.yaml')
const lock = existsSync(lockPath) ? parse(readFileSync(lockPath, 'utf8'), 'profile lock') : undefined
const locked = lock?.importers?.['.']?.dependencies?.[name]
const dependency = manifest.dependencies?.[name]
const count = (manifest.dsh?.profile?.bundles ?? []).filter(value => value === name).length
const installedPath = join(root, 'node_modules', name)
const installed = lstatSync(installedPath, { throwIfNoEntry: false }) !== undefined
if (dependency === undefined) {
  if (count !== 0 || locked !== undefined || (installed && mode !== '--finish-removal' && mode !== '--remove-dependency')) throw new Error('Mixed profile state: undeclared user-files Bundle, lock or installation remains')
  if (mode === '--verify') throw new Error('Resource links is not installed')
} else {
  if (mode === '--removed' || mode === '--finish-removal') throw new Error('Resource links dependency remains')
  if (dependency !== locked?.specifier) throw new Error('User files manifest and lock specifiers disagree')
  if (!installed || count !== 1) throw new Error('User files installation or Bundle membership is inconsistent')
  if (planUserFilesInstall({ profileDirectory: root }).length) throw new Error('User files provider is missing')
  if (locked.version.startsWith('link:') && realpathSync(resolve(root, locked.version.slice(5))) !== realpathSync(installedPath)) throw new Error('User files lock target differs from installed resolution')
}
function cli(args) {
  const result = spawnSync(process.execPath, ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', ...args], {
    cwd: checkout, env: process.env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  })
  if (result.status !== 0) throw new Error(`Profile inspection failed: ${result.stderr || result.stdout}`)
  return result.stdout
}
if (dependency !== undefined) cli(['plugin', '--profile', profile, 'why', name])
const tree = parse(cli(['--profile', profile, '--dump-config']), 'composed profile')
function rows(entries) {
  return entries.flatMap(entry => [entry, ...(entry.group && Array.isArray(entry.config) ? rows(entry.config) : [])])
}
const composedCount = rows(tree).filter(entry => entry.name === name).length
if (composedCount !== Number(dependency !== undefined)) throw new Error('Resource links composed row disagrees with installation')
if (mode === '--remove-dependency') {
  assertUserFilesRemovable({ profileDirectory: root })
  if (dependency !== undefined) console.log(cli(['plugin', '--profile', profile, 'remove', name]))
  else console.log('Resource links dependency, lock entry and composition are absent; checking residual installation next.')
  process.exit(0)
}
if (mode === '--finish-removal') removeOwnedLink(installedPath, target)
console.log(dependency === undefined ? 'Resource links is absent from manifest, lock, installation and composition.' : 'Resource links manifest, lock, installation, Bundle and composition identify this checkout.')
