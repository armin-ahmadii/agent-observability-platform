import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { OWN_LIVE_DIR, resolveLiveDir } from '../lib/live-dir.mjs'

const saved = process.env.SUBAGENT_DECK_LIVE
afterEach(() => { if (saved === undefined) delete process.env.SUBAGENT_DECK_LIVE; else process.env.SUBAGENT_DECK_LIVE = saved })

test('own folder when nothing is set', () => {
  delete process.env.SUBAGENT_DECK_LIVE
  assert.equal(resolveLiveDir(), OWN_LIVE_DIR)
  assert.ok(OWN_LIVE_DIR.endsWith('/live'))
})

test('SUBAGENT_DECK_LIVE, trimmed; blank is ignored', () => {
  process.env.SUBAGENT_DECK_LIVE = '  /x/y// '
  assert.equal(resolveLiveDir(), '/x/y')
  process.env.SUBAGENT_DECK_LIVE = '   '
  assert.equal(resolveLiveDir(), OWN_LIVE_DIR)
})

test('an explicit folder (--live) wins over the variable', () => {
  process.env.SUBAGENT_DECK_LIVE = '/x/y'
  assert.equal(resolveLiveDir('/flag'), '/flag')
})
