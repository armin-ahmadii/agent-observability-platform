import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { codexLimitsReader } from '../lib/codex-limits.mjs'

const NOW = Date.parse('2026-11-24T04:00:00Z')
const line = (ts, rl) => JSON.stringify({ timestamp: ts, type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits: rl } }) + '\n'
const nullRl = { limit_id: 'codex', primary: null, secondary: null, plan_type: null }
const rl = (used, mins, resets, plan = 'pro') => ({ limit_id: 'codex', primary: { used_percent: used, window_minutes: mins, resets_at: resets }, secondary: null, plan_type: plan })

function folder() {
  const dir = mkdtempSync(join(tmpdir(), 'codex-'))
  const local = new Date(NOW)
  const day = join(dir, String(local.getFullYear()), String(local.getMonth() + 1).padStart(2, '0'), String(local.getDate()).padStart(2, '0'))
  mkdirSync(day, { recursive: true })
  return { dir, day }
}
const file = (day, name, text, mtime) => { const p = join(day, name); writeFileSync(p, text); utimesSync(p, mtime / 1000, mtime / 1000); return p }

test('newest reading with a window wins; null readings and other lines are skipped', () => {
  const { dir, day } = folder()
  // older file has the real reading; the newest file only has null windows
  file(day, 'rollout-a.jsonl', line('2026-11-24T02:49:00Z', rl(12.5, 10080, 1796093347)) + '{"type":"other"}\n', NOW - 3 * 3600e3)
  file(day, 'rollout-b.jsonl', 'x'.repeat(300_000) + '\n' + line('2026-11-24T03:50:00Z', nullRl), NOW - 600e3)
  const r = codexLimitsReader(dir)(NOW)
  assert.deepEqual(r, { plan: 'pro', at: Date.parse('2026-11-24T02:49:00Z'), limits: [{ window: 'primary', minutes: 10080, percentUsed: 12.5, resetsAt: new Date(1796093347 * 1000).toISOString() }] })
})

test('appended lines are picked up; a passed reset reads as 0%', () => {
  const { dir, day } = folder()
  const p = file(day, 'rollout-a.jsonl', line('2026-11-24T02:00:00Z', rl(40, 300, NOW / 1000 + 3600)), NOW - 3600e3)
  const read = codexLimitsReader(dir)
  assert.equal(read(NOW).limits[0].percentUsed, 40)
  appendFileSync(p, line('2026-11-24T03:59:00Z', rl(55, 300, NOW / 1000 - 60)))
  const later = read(NOW + 20_000)
  assert.equal(later.limits[0].percentUsed, 0)
  assert.equal(later.limits[0].resetsAt, null)
})

test('no Codex folder: null', () => {
  assert.equal(codexLimitsReader(join(tmpdir(), 'no-such-codex-dir'))(NOW), null)
})
