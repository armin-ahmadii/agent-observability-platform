// The "All sessions" view: every open session in one snapshot, its MCP servers, and the chats in a timeframe.
import { sessionMcp, toolCounts } from './history.mjs'
import { isId } from './paths.mjs'
import { isHidden, listSessions, listSessionsWeek, readSessionFile } from './sessions.mjs'
import { DAY, SECOND } from './time.mjs'
import { displayTitle } from './titles.mjs'
import { usageWindow } from './usage-store.mjs'

// The All view's timeframes. "active" sums only the chats working now (their last 24 hours).
const WINDOWS = { active: DAY, '24h': DAY, '7d': 7 * DAY, '30d': 30 * DAY }
export const windowMs = win => WINDOWS[win] ?? DAY
// A timeframe from the page, or '24h' when missing or unknown.
export const knownWin = win => Object.hasOwn(WINDOWS, win ?? '') ? win : '24h'

// "active": the page sends the chats it shows as working (s=id,id); their T3 helpers' sessions count with them.
export function activeSessionIds(url) {
  const set = new Set((url.searchParams.get('s') ?? '').split(',').filter(isId))
  for (const s of listSessions()) if (s.parentId && set.has(s.parentId)) set.add(s.id)
  return set
}

// Usage for a timeframe, limited to `only` for "active".
export const usageFor = (win, only) => usageWindow(windowMs(win), win === 'active' ? only ?? new Set() : null)

// T3's one-off chats each get a dated scratch folder ("2026-01-02-some-words-1a2b3c4d"); they are not a project.
const isScratchFolder = p => /^\d{4}-\d{2}-\d{2}-.*-[0-9a-f]{8}$/.test(String(p ?? ''))
const projectKey = p => 'project:' + (isScratchFolder(p) ? 'scratch' : String(p ?? 'other'))
const projectLabel = p => isScratchFolder(p) ? 'Scratch chats' : String(p ?? 'Other')

// Each open session's main conversation becomes a row named after the session, its agents nested under it,
// and sessions are grouped under their project (the folder they run in).
export function allSessions(win = '24h', only = null) {
  const list = listSessions().filter(x => x.isLive && !x.parentId)
  const runs = [], servers = {}, serverTokens = {}
  let totalUsd = 0, rateLimits
  for (const s of list) {
    const d = readSessionFile(s.id)
    if (!d) continue
    totalUsd += d.totalUsd ?? 0
    rateLimits ??= d.rateLimits
    Object.assign(servers, d.servers ?? {})
    if (s.hidden) continue // hidden from the dashboard: still counted in the totals above
    for (const [k, v] of Object.entries(d.serverTokens ?? {})) serverTokens[k] = (serverTokens[k] ?? 0) + v
    for (const r of d.runs ?? []) {
      if (r.id === 'triage') continue
      const id = `${s.id}:${r.id}`
      if (r.id === 'main') {
        // The main conversation's share of the last 24 hours.
        runs.push({ ...r, id, label: s.title || s.project || 'Session', usd: s.day.mainUsd, tokens: s.day.mainTokens, sessionOf: s.id, session: s.id, lastAskAt: d.lastAsk?.at ?? d.recentAsks?.[0]?.at })
      } else {
        runs.push({ ...r, id, parentId: `${s.id}:${r.parentId ?? 'main'}`, sessionOf: s.id })
      }
    }
  }
  const projectOf = r => list.find(x => x.id === r.sessionOf)?.project
  const projects = new Map()
  for (const r of runs) {
    if (!r.id.endsWith(':main')) continue
    const project = projectOf(r)
    if (isScratchFolder(project)) continue // scratch chats stay top-level rows
    const key = projectKey(project)
    const pr = projects.get(key) ?? projects.set(key, { id: key, type: 'project', label: projectLabel(project), now: 'done', startedAt: r.startedAt, segments: [], mcp: {}, usd: 0, tokens: 0, costKnown: true }).get(key)
    r.parentId = key
    pr.usd += r.usd ?? 0
    pr.startedAt = Math.min(pr.startedAt ?? Infinity, r.startedAt ?? Infinity)
    if (r.now !== 'done') pr.now = 'running'
  }
  for (const r of runs) {
    const pr = r.sessionOf && projects.get(projectKey(projectOf(r)))
    if (pr) pr.tokens += r.tokens ?? 0
    if (pr && !r.id.endsWith(':main')) pr.usd += r.usd ?? 0
  }
  const d = usageFor(win, only)
  const day = { win, usd: d.usd, tokens: d.tokens, mainUsd: d.mainUsd, subUsd: d.subUsd, chats: d.chats, subs: d.subs, pace: d.pace }
  return { sessionId: 'all', project: 'All sessions', updatedAt: Date.now(), totalUsd, day, servers, serverTokens, runs: [...projects.values(), ...runs], helpers: [], rateLimits, sessions: list.length }
}

// Every open session's MCP servers, added together.
export function allMcpHistory() {
  const per = {}
  for (const s of listSessions().filter(x => x.isLive && !x.parentId && !x.hidden)) {
    let rows = []
    try { rows = sessionMcp(s.id) } catch {}
    for (const x of rows) {
      const y = (per[x.server] ??= { server: x.server, calls: 0, tools: {}, firstAt: Infinity, lastAt: 0, agents: [] })
      y.calls += x.calls
      for (const t of x.tools) y.tools[t.name] = (y.tools[t.name] ?? 0) + t.n
      y.firstAt = Math.min(y.firstAt, x.firstAt)
      y.lastAt = Math.max(y.lastAt, x.lastAt)
      y.agents.push(...x.agents.map(a => s.id + ':' + a))
    }
  }
  return Object.values(per).map(y => ({ ...y, tools: toolCounts(y.tools) }))
}

// Every chat with usage in a timeframe (open or closed), with the T3 helpers it delegated to folded in
// (while the session files still say so, up to a week), newest first. The All view's "Previous orchestrators".
const CHATS_CACHE_MS = 10 * SECOND
const chatsCache = new Map()
export function windowChats(win) {
  const hit = chatsCache.get(win)
  if (hit && Date.now() - hit.at < CHATS_CACHE_MS) return hit.list
  const list = readWindowChats(win)
  chatsCache.set(win, { at: Date.now(), list })
  return list
}
function readWindowChats(win) {
  const d = usageWindow(windowMs(win))
  const files = listSessionsWeek()
  const fileOf = id => files.find(x => x.id === id)
  const out = new Map()
  for (const [id, x] of Object.entries(d.bySession)) {
    const pid = fileOf(id)?.parentId ?? id
    if (isHidden(pid)) continue
    const s = fileOf(pid)
    const c = out.get(pid) ?? out.set(pid, { id: pid, title: s?.title || displayTitle(pid) || s?.project || 'Session', project: s?.project, model: null, usd: 0, tokens: 0, last: 0 }).get(pid)
    c.usd += x.usd; c.tokens += x.tokens; c.last = Math.max(c.last, x.last)
    if (pid === id) c.model = s?.model ?? x.model
  }
  return [...out.values()].map(c => ({ ...c, model: c.model ?? d.bySession[c.id]?.model })).sort((a, b) => b.last - a.last)
}
