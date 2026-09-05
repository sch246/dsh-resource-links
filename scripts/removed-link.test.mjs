import { mkdtempSync, mkdirSync, lstatSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { removeOwnedLink } from './removed-link.mjs'

test('removes only the exact owned leftover symlink, retaining its target', () => {
  const root = mkdtempSync(join(tmpdir(), 'resource-links-removal-'))
  try {
    const target = join(root, 'target')
    const other = join(root, 'other')
    const link = join(root, 'link')
    mkdirSync(target)
    mkdirSync(other)
    removeOwnedLink(link, target)
    symlinkSync(target, link)
    removeOwnedLink(link, target)
    assert.equal(lstatSync(link, { throwIfNoEntry: false }), undefined)
    assert.ok(lstatSync(target).isDirectory())
    symlinkSync(other, link)
    assert.throws(() => removeOwnedLink(link, target), /Refusing/)
    assert.ok(lstatSync(link).isSymbolicLink())
    assert.throws(() => removeOwnedLink(other, target), /Refusing/)
    assert.ok(lstatSync(other).isDirectory())
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
