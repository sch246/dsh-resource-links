/** Apply or reverse only the Host adapter recorded by this plugin's receipt. */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const receiptName = 'dsh-user-files.patch-state'

function git(checkout, args) {
  return execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function accepts(checkout, patchPath, reverse) {
  try {
    git(checkout, ['apply', '--check', ...(reverse ? ['--reverse'] : []), patchPath])
    return true
  } catch (error) {
    if (error.status !== 1) throw error
    return false
  }
}

function readReceipt(path) {
  if (!existsSync(path)) return undefined
  const value = JSON.parse(readFileSync(path, 'utf8'))
  if (value.format !== 1 || typeof value.patchSha256 !== 'string'
    || typeof value.hostRoot !== 'string' || typeof value.hostHead !== 'string'
    || !['applying', 'applied', 'removing'].includes(value.status)) {
    throw new Error('user-files: malformed Host ownership receipt; preserve it for recovery')
  }
  return value
}

function saveReceipt(path, value) {
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  try {
    renameSync(temporary, path)
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
  }
}

/**
 * Inspect, apply, or remove an exact plugin-owned patch; unrelated Host edits remain untouched.
 * @param options Explicit checkout, patch file, and check/apply/remove operation.
 * @returns The verified adapter state after the operation.
 */
export function managePatch({ checkout, patchPath, mode = 'check' }) {
  if (!['check', 'apply', 'remove'].includes(mode)) throw new Error('user-files: unknown Host patch operation')
  const hostRoot = realpathSync(checkout)
  if (realpathSync(git(hostRoot, ['rev-parse', '--show-toplevel'])) !== hostRoot) {
    throw new Error('user-files: DSH_CHECKOUT must name the Git checkout root')
  }
  const patch = realpathSync(patchPath)
  const patchSha256 = createHash('sha256').update(readFileSync(patch)).digest('hex')
  const receiptPath = resolve(hostRoot, git(hostRoot, ['rev-parse', '--git-path', receiptName]))
  const inspect = () => {
    const receipt = readReceipt(receiptPath)
    if (receipt !== undefined && (receipt.patchSha256 !== patchSha256 || receipt.hostRoot !== hostRoot)) {
      throw new Error('user-files: receipt identifies another patch or Host; refusing ownership transfer')
    }
    const forward = accepts(hostRoot, patch, false)
    const reverse = accepts(hostRoot, patch, true)
    if (receipt === undefined) {
      if (!forward || reverse) throw new Error('user-files: Host adapter is unowned or has drifted; refusing adoption')
      return { status: 'absent', receipt }
    }
    if (reverse && !forward) return { status: 'applied', receipt }
    if (forward && !reverse && receipt.status !== 'applied') return { status: 'absent', receipt }
    throw new Error('user-files: owned Host adapter has drifted; preserve source and receipt for recovery')
  }
  if (mode === 'check') {
    const current = inspect()
    if (current.receipt !== undefined && current.receipt.status !== 'applied') {
      throw new Error(`user-files: interrupted ${current.receipt.status} operation; resume it explicitly`)
    }
    return current.status
  }
  const lock = `${receiptPath}.lock`
  mkdirSync(lock, { mode: 0o700 })
  try {
    const current = inspect()
    if (mode === 'apply') {
      if (current.receipt?.status === 'removing') throw new Error('user-files: finish the interrupted removal first')
      const receipt = current.receipt ?? {
        format: 1, patchSha256, hostRoot, hostHead: git(hostRoot, ['rev-parse', 'HEAD']), status: 'applying',
      }
      if (current.status === 'absent') {
        saveReceipt(receiptPath, { ...receipt, status: 'applying' })
        git(hostRoot, ['apply', patch])
      }
      if (!accepts(hostRoot, patch, true)) throw new Error('user-files: applied adapter failed reverse verification')
      saveReceipt(receiptPath, { ...receipt, status: 'applied' })
      return 'applied'
    }
    if (current.receipt === undefined) return 'absent'
    saveReceipt(receiptPath, { ...current.receipt, status: 'removing' })
    if (current.status === 'applied') git(hostRoot, ['apply', '--reverse', patch])
    if (!accepts(hostRoot, patch, false)) throw new Error('user-files: removed adapter failed forward verification')
    unlinkSync(receiptPath)
    return 'absent'
  } finally {
    rmdirSync(lock)
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const checkout = process.env.DSH_CHECKOUT
    if (checkout === undefined || checkout === '') throw new Error('user-files: set DSH_CHECKOUT explicitly')
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
    const mode = (process.argv[2] ?? '--check').replace(/^--/, '')
    console.log(`user-files: Host adapter ${managePatch({ checkout, patchPath: resolve(root, 'patches/deepseek-harness.patch'), mode })}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
