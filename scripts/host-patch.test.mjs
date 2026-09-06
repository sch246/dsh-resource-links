/** Ownership and recovery checks use independent disposable Git fixtures. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { managePatch } from './host-patch.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-resource-links-patch-'))
  t.after(() => { rmSync(root, { recursive: true, force: true }) })
  execFileSync('git', ['init', '-q', root])
  const source = join(root, 'adapter.txt')
  const patchPath = join(root, 'adapter.patch')
  writeFileSync(source, 'before\n')
  execFileSync('git', ['-C', root, 'add', 'adapter.txt'])
  execFileSync('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'baseline'])
  writeFileSync(patchPath, 'diff --git a/adapter.txt b/adapter.txt\n--- a/adapter.txt\n+++ b/adapter.txt\n@@ -1 +1 @@\n-before\n+after\n')
  return { root, source, patchPath, receipt: join(root, '.git/dsh-user-files.patch-state'), run: mode => managePatch({ checkout: root, patchPath, mode }) }
}

test('inspection is read-only; apply is idempotent and removal preserves unrelated data', t => {
  const f = fixture(t)
  writeFileSync(join(f.root, 'unrelated.txt'), 'user draft\n')
  assert.equal(f.run('check'), 'absent')
  assert.equal(existsSync(f.receipt), false)
  assert.equal(f.run('apply'), 'applied')
  assert.equal(f.run('apply'), 'applied')
  assert.equal(f.run('check'), 'applied')
  assert.equal(readFileSync(f.source, 'utf8'), 'after\n')
  assert.equal(f.run('remove'), 'absent')
  assert.equal(f.run('remove'), 'absent')
  assert.equal(readFileSync(f.source, 'utf8'), 'before\n')
  assert.equal(readFileSync(join(f.root, 'unrelated.txt'), 'utf8'), 'user draft\n')
  assert.equal(existsSync(f.receipt), false)
})

test('an already applied but unowned patch cannot be adopted or removed', t => {
  const f = fixture(t)
  writeFileSync(f.source, 'after\n')
  for (const mode of ['check', 'apply', 'remove']) assert.throws(() => f.run(mode), /unowned/)
  assert.equal(readFileSync(f.source, 'utf8'), 'after\n')
})

test('receipt mismatch and Host drift block reversal without data loss', t => {
  const f = fixture(t)
  f.run('apply')
  writeFileSync(f.source, 'user modification\n')
  assert.throws(() => f.run('remove'), /drifted/)
  assert.equal(readFileSync(f.source, 'utf8'), 'user modification\n')
  const receipt = JSON.parse(readFileSync(f.receipt, 'utf8'))
  writeFileSync(f.receipt, JSON.stringify({ ...receipt, patchSha256: 'different' }))
  assert.throws(() => f.run('apply'), /another patch/)
})

test('interrupted apply resumes only from its recorded exact state', t => {
  const f = fixture(t)
  f.run('apply')
  const receipt = JSON.parse(readFileSync(f.receipt, 'utf8'))
  writeFileSync(f.receipt, JSON.stringify({ ...receipt, status: 'applying' }))
  assert.throws(() => f.run('check'), /interrupted/)
  assert.equal(f.run('apply'), 'applied')
  assert.equal(JSON.parse(readFileSync(f.receipt, 'utf8')).status, 'applied')
})

test('interrupted removal resumes after source reversal', t => {
  const f = fixture(t)
  f.run('apply')
  const receipt = JSON.parse(readFileSync(f.receipt, 'utf8'))
  writeFileSync(f.receipt, JSON.stringify({ ...receipt, status: 'removing' }))
  writeFileSync(f.source, 'before\n')
  assert.throws(() => f.run('apply'), /finish.*removal/)
  assert.equal(f.run('remove'), 'absent')
  assert.equal(existsSync(f.receipt), false)
})
