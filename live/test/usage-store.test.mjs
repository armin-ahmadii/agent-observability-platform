import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// A data folder with a hand-made usage store; the module reads it when first imported.
const dir = mkdtempSync(join(tmpdir(), 'deck-usage-'))
process.env.SUBAGENT_DECK_LIVE = dir
const HOUR = 3600_000
const now = Date.now()
const hour = h => String(now - (now % HOUR) - h * HOUR)
// [usd, tokens, input, output, write5m, write1h, read, replies]
const bucket = (usd, tokens) => [usd, tokens, tokens, 0, 0, 0, 0, 1]
writeFileSync(join(dir, 'usage-hours.json'), JSON.stringify({ v: 1, files: {
  '/p/a.jsonl': { s: 'a', b: 0, p: 0, m: now, a: now, h: { [hour(1)]: { 'claude-opus-5-5': bucket(1, 100) }, [hour(48)]: { 'claude-opus-5-5': bucket(10, 1000) } } },
  '/p/a/subagents/agent-x.jsonl': { s: 'a', b: 1, p: 0, m: now, a: now, h: { [hour(2)]: { 'claude-haiku-5-5': bucket(0.5, 50) } } },
  '/p/b.jsonl': { s: 'b', b: 0, p: 0, m: now, a: now, h: { [hour(3)]: { 'claude-opus-5-5': bucket(2, 200) } } },
} }))
const { usageWindow } = await import('../lib/usage-store.mjs')

test('a 24-hour window sums only its hours', () => {
  const d = usageWindow(24 * HOUR)
  assert.equal(d.usd, 3.5)
  assert.equal(d.tokens, 350)
  assert.equal(d.mainUsd, 3)
  assert.equal(d.subUsd, 0.5)
  assert.equal(d.chats, 2)
  assert.equal(d.bySession.a.usd, 1.5)
  assert.equal(d.bySession.a.mainUsd, 1)
  assert.equal(d.bySession.a.model, 'claude-opus-5-5')
})

test('a 7-day window includes older hours', () => {
  assert.equal(usageWindow(7 * 24 * HOUR).usd, 13.5)
})

test('only: limits to the given sessions', () => {
  assert.equal(usageWindow(24 * HOUR, new Set(['b'])).usd, 2)
})
