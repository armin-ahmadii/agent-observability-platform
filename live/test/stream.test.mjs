import assert from 'node:assert/strict'
import { mkdtempSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const live = mkdtempSync(join(tmpdir(), 'deck-stream-'))
process.env.SUBAGENT_DECK_LIVE = live
const { idsForView, sessionIdOfFile, watchSessions } = await import('../lib/stream.mjs')

const tick = ms => new Promise(r => setTimeout(r, ms))
const write = (dir, id) => {
  writeFileSync(join(dir, `${id}.json.tmp`), '{}')
  renameSync(join(dir, `${id}.json.tmp`), join(dir, `${id}.json`))
}

test('session ids from file names, temp files included', () => {
  assert.equal(sessionIdOfFile('abc-123.json'), 'abc-123')
  assert.equal(sessionIdOfFile('abc-123.json.tmp'), 'abc-123')
  assert.equal(sessionIdOfFile('abc-123.json.4821.tmp'), 'abc-123')
  for (const name of ['hidden.json.bak', '.DS_Store', 'a b.json', null]) assert.equal(sessionIdOfFile(name), null, String(name))
})

test('each view gets only its own changes', () => {
  const related = id => (id === 'p' ? ['child'] : [])
  assert.deepEqual(idsForView('all', new Set(['p', 'x']), related), ['p', 'x'])
  assert.deepEqual(idsForView('p', new Set(['p', 'child', 'x']), related), ['p', 'child'])
  assert.deepEqual(idsForView('q', new Set(['p']), related), [])
})

test('a write (temp file + rename) is reported once, quickly', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'deck-watch-'))
  const calls = []
  const stop = watchSessions(ids => calls.push([...ids]), dir)
  await tick(50)
  const t = Date.now()
  write(dir, 's1')
  write(dir, 's2')
  while (!calls.length && Date.now() - t < 2000) await tick(5)
  const ms = Date.now() - t
  await tick(100)
  stop()
  assert.equal(calls.length, 1, JSON.stringify(calls))
  assert.deepEqual(calls[0].sort(), ['s1', 's2'])
  assert.ok(ms < 300, `took ${ms} ms`)
})

test('the backup scan alone catches writes and deletions within ~250 ms', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'deck-scan-'))
  write(dir, 'old')
  const calls = []
  const stop = watchSessions(ids => calls.push([...ids]), dir, { fsWatch: false })
  await tick(300)
  assert.deepEqual(calls, [], 'files already there are not reported')
  let t = Date.now()
  writeFileSync(join(dir, 'new.json'), '{"a":1}')
  while (!calls.length && Date.now() - t < 2000) await tick(5)
  assert.deepEqual(calls, [['new']])
  assert.ok(Date.now() - t < 400, `took ${Date.now() - t} ms`)
  t = Date.now()
  unlinkSync(join(dir, 'old.json'))
  while (calls.length < 2 && Date.now() - t < 2000) await tick(5)
  stop()
  assert.deepEqual(calls[1], ['old'])
})

test('a write seen by both fs.watch and the scan is reported once', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'deck-dedupe-'))
  const calls = []
  const stop = watchSessions(ids => calls.push([...ids]), dir)
  await tick(50)
  writeFileSync(join(dir, 's.json'), '{"v":1}')
  await tick(700) // fs.watch, then two or more scans
  stop()
  assert.deepEqual(calls, [['s']])
})
