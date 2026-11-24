import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// A fake home and live folder with two open sessions; modules read them when first imported.
const home = mkdtempSync(join(tmpdir(), 'deck-asks-'))
process.env.HOME = home
process.env.SUBAGENT_DECK_LIVE = join(home, 'live')
mkdirSync(join(home, 'live', 'sessions'), { recursive: true })
const asks = n => Array.from({ length: n }, (_, i) => ({ at: 1000 - i, text: `ask ${i}`, routedTo: i ? [] : [{ runId: 'a1', label: 'Helper', kind: 'subagent' }] }))
const session = (id, recentAsks) => writeFileSync(join(home, 'live', 'sessions', `${id}.json`),
  JSON.stringify({ sessionId: id, project: 'p', runs: [{ id: 'main', label: 'Main', now: 'running', startedAt: 1 }], recentAsks, lastAsk: recentAsks[0] }))
session('s1', asks(7))
session('s2', asks(2))
const { allSessions } = await import('../lib/all-view.mjs')
const { setHidden } = await import('../lib/sessions.mjs')

test('the All view carries each open session\'s last 5 messages, newest first', () => {
  const snap = allSessions('24h')
  assert.equal(snap.recentAsks.s1.length, 5)
  assert.deepEqual(snap.recentAsks.s1.map(a => a.text), ['ask 0', 'ask 1', 'ask 2', 'ask 3', 'ask 4'])
  assert.deepEqual(snap.recentAsks.s1[0].routedTo, [{ runId: 'a1', label: 'Helper', kind: 'subagent' }])
  assert.equal(snap.recentAsks.s2.length, 2)
})

test('hidden sessions\' messages are left out', () => {
  setHidden('s2', true)
  assert.equal(allSessions('24h').recentAsks.s2, undefined)
  setHidden('s2', false)
})
