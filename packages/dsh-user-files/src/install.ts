/** Shared-provider installation planning; all mutations remain in the dsh plugin transaction. */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import semver from 'semver'

const name = '@dsh-external/dsh-user-files'
const candidate = dirname(createRequire(import.meta.url).resolve('@dsh-external/dsh-user-files/package.json'))
interface Manifest {
  name: string
  version: string
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
}
const read = (path: string): Manifest => JSON.parse(readFileSync(path, 'utf8')) as Manifest

function consumers(profileDirectory: string, additional?: string) {
  const profilePath = join(profileDirectory, 'package.json')
  const profile: Partial<Manifest> = existsSync(profilePath) ? read(profilePath) : {}
  const packages = Object.keys(profile.dependencies ?? {}).filter(value => value !== name)
    .map(value => read(join(profileDirectory, 'node_modules', value, 'package.json')))
  if (additional) {
    const incoming = read(join(additional, 'package.json'))
    const index = packages.findIndex(value => value.name === incoming.name)
    if (index !== -1) packages.splice(index, 1)
    packages.push(incoming)
  }
  const requirements = packages.flatMap(pkg => (['dependencies', 'peerDependencies'] as const).flatMap(field => {
    const range = pkg[field]?.[name]
    return range === undefined ? [] : [{ consumer: pkg.name, range }]
  }))
  return { profile, requirements }
}

/** @param options Profile directory and optional incoming consumer package directory. @returns Provider path to add, or an empty list when the installed provider is reusable. */
export function planUserFilesInstall({ profileDirectory, consumerPackage }: { profileDirectory: string; consumerPackage?: string }): string[] {
  const { profile, requirements } = consumers(profileDirectory, consumerPackage)
  const installed = profile.dependencies?.[name] !== undefined
  const providerDirectory = installed ? join(profileDirectory, 'node_modules', name) : candidate
  const provider = read(join(providerDirectory, 'package.json'))
  if (provider.name !== name) throw new Error(`Expected ${name} at ${providerDirectory}`)
  for (const { consumer, range } of requirements) {
    if (!semver.validRange(range) || !semver.satisfies(provider.version, range, { includePrerelease: true })) {
      throw new Error(`${consumer} requires ${name} ${range}; selected provider is ${provider.version}`)
    }
  }
  const bundles = (profile.dsh?.profile?.bundles ?? []).filter(value => value === name).length
  if (bundles !== Number(installed)) throw new Error(`${name} must have exactly one Bundle when installed`)
  return installed ? [] : [candidate]
}

/** @param options Profile directory. @returns Nothing; throws with remaining consumer names when removal is unsafe. */
export function assertUserFilesRemovable({ profileDirectory }: { profileDirectory: string }): void {
  const { requirements } = consumers(profileDirectory)
  if (requirements.length) throw new Error(`Retain ${name}; required by ${[...new Set(requirements.map(value => value.consumer))].join(', ')}`)
}
