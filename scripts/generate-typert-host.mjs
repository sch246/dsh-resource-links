import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = join(import.meta.dirname, '..')
const checkout = process.env.DSH_CHECKOUT
if (!checkout) throw new Error('generate-typert: set DSH_CHECKOUT explicitly')
const entry = join(checkout, 'packages/typert/generator/lib/types/index.js')
if (!existsSync(entry)) throw new Error(`Build the candidate Harness Host first: ${entry}`)
const { WorkspaceTypertGenerator } = await import(pathToFileURL(entry).href)
const [artifact] = new WorkspaceTypertGenerator(root, {
  checkDiagnostics: false, externalProjectReferences: true,
}).generate(['@dsh-external/dsh-resource-links'], ['host'])
if (!artifact?.remote) throw new Error('Expected one resource-links Host artifact with Remote metadata')
const output = join(root, artifact.packageRoot, 'lib')
mkdirSync(output, { recursive: true })
for (const [name, content] of [
  ['typert.host.js', artifact.js], ['typert.host.d.ts', artifact.dts],
  ['typert.remote-client.js', artifact.remote.js], ['typert.remote-client.d.ts', artifact.remote.dts],
  ['typert.remote-client.d.ts.map', artifact.remote.dtsMap],
]) writeFileSync(join(output, name), content)
