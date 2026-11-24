// Every agent that finished in a timeframe, from every session (open or closed): subagents rebuilt from
// transcripts, and T3 helpers from the session that delegated them. Ids match the All view's live rows
// ("<session>:<run>"), so the page can de-duplicate.
import { sessionHistory } from './history.mjs'
import { listSessions, listSessionsWeek, readSessionFile } from './sessions.mjs'
import { isResolved } from './resolved.mjs'
import { DAY, SECOND, yieldToEventLoop } from './time.mjs'
import { displayTitle } from './titles.mjs'
import { isUsageReady, usageWindow } from './usage-store.mjs'

const WARM_DAYS_MS = 30 * DAY
const WHERE_CHARS = 120
const CACHE_MS_DAY = 8 * SECOND
const CACHE_MS_LONG = 20 * SECOND
const CACHE_MS_WARMING = 1 * SECOND

// Long timeframes would read every session's subagents at once. Instead they are read one session at a time in
// the background after start-up; until that finishes, long timeframes list only the sessions read so far (and
// the last day's), so one request never blocks the page for seconds.
let warming = false, warmDone = false
const warmed = new Set()
export async function warmLongTimeframes() {
  if (warming) return
  warming = true
  for (const sid of usageWindow(WARM_DAYS_MS).sessions) {
    try { displayTitle(sid); sessionHistory(sid) } catch {}
    warmed.add(sid)
    await yieldToEventLoop()
  }
  warmDone = true
}

const cache = new Map()
function cacheMs(ms) {
  if (!isUsageReady() || (!warmDone && ms > DAY)) return CACHE_MS_WARMING
  return ms > DAY ? CACHE_MS_LONG : CACHE_MS_DAY
}

export function finishedAgents(ms = DAY) {
  const hit = cache.get(ms)
  if (hit && Date.now() - hit.at < cacheMs(ms)) return hit.rows
  const from = Date.now() - ms
  const all = ms > DAY ? listSessionsWeek() : listSessions()
  const where = id => {
    const s = all.find(x => x.id === id)
    return (s?.title || displayTitle(id) || s?.project || '').slice(0, WHERE_CHARS)
  }
  const rows = []
  const lastDay = new Set(ms > DAY && !warmDone ? usageWindow(DAY).sessions : [])
  for (const sid of usageWindow(ms).sessions) {
    if (ms > DAY && !warmDone && !warmed.has(sid) && !lastDay.has(sid)) continue
    let hist = []
    try { hist = sessionHistory(sid) } catch {}
    for (const h of hist) {
      if ((h.endedAt || h.startedAt) < from) continue
      rows.push({ ...h, id: `${sid}:${h.id}`, sessionOf: sid, where: where(sid) })
    }
  }
  for (const parent of all) {
    const d = readSessionFile(parent.id)
    if (!d) continue
    for (const r of d.runs ?? []) {
      if (r.type !== 'delegated') continue
      const row = finishedHelper(parent, r, all, from, where)
      if (row) rows.push(row)
    }
  }
  rows.sort((a, b) => (b.endedAt || b.startedAt) - (a.endedAt || a.startedAt))
  cache.set(ms, { at: Date.now(), rows })
  return rows
}

// A T3 helper run `r` of `parent`, merged with its own session's main run when that session is known.
// (Exported for tests.)
export function finishedHelper(parent, r, all, from, where) {
  const child = all.filter(x => (x.title === r.label || x.rawTitle === r.label) && x.id !== parent.id).sort((a, b) => b.updatedAt - a.updatedAt)[0]
  if (child && child.isLive && child.working > 0) return null // still at work: it is a live row
  const c = child ? readSessionFile(child.id)?.runs?.find(x => x.id === 'main') ?? null : null
  if (!child && r.now !== 'done') return null
  const segs = c?.segments ?? r.segments ?? []
  const endedAt = r.endedAt ?? (Math.max(0, ...segs.map(x => x.end)) || child?.updatedAt || r.startedAt)
  if (endedAt < from) return null
  return {
    ...r, id: `${parent.id}:${r.id}`, parentId: undefined, sessionOf: parent.id, where: where(parent.id), now: 'done', endedAt,
    session: child?.id, usd: child ? child.totalUsd ?? 0 : r.usd, costKnown: child ? child.costKnown !== false : r.costKnown, // Codex helpers have no price list
    ...(c ? { segments: c.segments ?? [], mcp: c.mcp ?? {}, tokens: c.tokens ?? 0, model: c.model ?? r.model, effort: c.effort ?? r.effort,
      tasks: c.tasks?.length ? c.tasks : r.tasks, done: c.done?.length ? c.done : r.done, plan: c.plan?.length ? c.plan : r.plan, asks: c.asks?.length ? c.asks : r.asks,
      attention: isResolved(parent.id, r) ? undefined : c.attention ?? r.attention, startedAt: Math.min(r.startedAt ?? Infinity, c.startedAt ?? Infinity) } : {}),
  }
}
