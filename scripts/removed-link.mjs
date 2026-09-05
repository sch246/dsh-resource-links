import { lstatSync, realpathSync, unlinkSync } from 'node:fs'

/** Remove only this checkout's leftover package symlink after profile removal is verified. */
export function removeOwnedLink(path, target) {
  const stat = lstatSync(path, { throwIfNoEntry: false })
  if (!stat) return
  if (!stat.isSymbolicLink() || realpathSync(path) !== realpathSync(target)) {
    throw new Error('Refusing to remove an installation not linked to this checkout')
  }
  unlinkSync(path)
}
