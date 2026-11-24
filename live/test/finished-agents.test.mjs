import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// A fake home and live folder; the modules read them when first imported.
const home = mkdtempSync(join(tmpdir(), 'deck-finished-'))
process.env.HOME = home
process.env.SUBAGENT_DECK_LIVE = join(home, 'live')
mkdirSync(join(home, 'live', 'sessions'), { recursive: true })
mkdirSync(join(home, '.claude', 'projects'), { recursive: true })
const { finishedHelper } = await import('../lib/finished-agents.mjs')

const asks = [
  { title: 'Add resolve button to failed rows', at: 1, steps: ['Add the button'], done: [0], finishedAt: 5 },
  { title: 'Make timeline bars thinner', at: 6, steps: ['Find the styles', 'Thin them'], done: [0], now: 1 },
]
const parent = { id: 'p1' }
const delegated = { id: 'task:1-1', type: 'delegated', label: 'Page polish', now: 'done', startedAt: 1, segments: [], mcp: {}, usd: 0, tokens: 0 }
const where = () => 'project'

test("a finished T3 helper carries its own session's asks", () => {
  writeFileSync(join(home, 'live', 'sessions', 'c1.json'), JSON.stringify({
    sessionId: 'c1',
    runs: [{ id: 'main', type: 'main', label: 'Page polish', now: 'done', startedAt: 2, segments: [{ start: 2, end: 9 }], mcp: {}, tokens: 10, plan: asks[1].steps, asks }],
  }))
  const all = [{ id: 'c1', title: 'Page polish', isLive: false, working: 0, updatedAt: 9 }]
  const row = finishedHelper(parent, delegated, all, 0, where)
  assert.deepEqual(row.asks, asks)
  assert.deepEqual(row.plan, asks[1].steps)
})

test("without its own session, the parent's row keeps whatever asks it had", () => {
  const own = [{ title: 'Polish the page', at: 1, steps: [], done: [] }]
  const row = finishedHelper(parent, { ...delegated, asks: own }, [], 0, where)
  assert.deepEqual(row.asks, own)
})
