// T3 delegated helpers whose child thread already finished, read from T3's own run records.
// Helpers on other providers (Codex, …) never load the mod, and the parent's "finished" notice can be missed
// while the mod reloads, so the session file may still say "running". T3's latest run for the thread decides.
import { SECOND } from './time.mjs'
import { withT3Db } from './t3-db.mjs'

const CACHE_MS = 5 * SECOND
// T3 run status → the attention the dashboard shows (completed needs none).
const ENDED = { completed: null, failed: 'failed', cancelled: 'stopped', interrupted: 'stopped' }

const cache = new Map() // childThreadId → { at, end: { attention, endedAt } | null }

// For each thread id: how its latest T3 run ended, or null while it runs (or when T3 can't be read).
function threadEnds(threadIds) {
  const now = Date.now()
  const stale = threadIds.filter(id => !(now - (cache.get(id)?.at ?? 0) < CACHE_MS))
  if (stale.length) {
    const rows = withT3Db(db => {
      const q = db.prepare(`SELECT status, completed_at FROM orchestration_v2_projection_runs WHERE thread_id = ? ORDER BY ordinal DESC LIMIT 1`)
      return stale.map(id => [id, q.get(id)])
    })
    for (const id of stale) {
      const row = rows?.find(([x]) => x === id)?.[1]
      const ended = row && row.status in ENDED
      cache.set(id, { at: now, end: ended ? { attention: ENDED[row.status], endedAt: Date.parse(row.completed_at) || undefined } : null })
    }
  }
  return new Map(threadIds.map(id => [id, cache.get(id)?.end ?? null]))
}

// A session file's data with finished T3 helpers marked done.
export function applyT3Finished(data) {
  const open = (data?.runs ?? []).filter(r => r.type === 'delegated' && r.now !== 'done' && r.childThreadId)
  if (!open.length) return data
  const ends = threadEnds([...new Set(open.map(r => String(r.childThreadId)))])
  data.runs = data.runs.map(r => {
    const end = open.includes(r) ? ends.get(String(r.childThreadId)) : null
    if (!end) return r
    return { ...r, now: 'done', endedAt: r.endedAt ?? end.endedAt, ...(end.attention && !r.attention ? { attention: end.attention } : {}) }
  })
  return data
}
