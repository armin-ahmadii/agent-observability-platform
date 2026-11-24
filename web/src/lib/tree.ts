// The agent tree of the shown session, and which parts of it the Agents section keeps on screen.
import { deck } from '../data/store'
import { ATTN, finishedAt, isMainRow, isQueued, isStateWord, isWorking, needsYou, runRef } from './agents'
import { MINUTE } from './format'
import type { Run, Snap, Win } from './types'

// A T3 delegated task runs as its own session: find it by title and show its live state and cost.
function linkTask(r: Run): Run {
  if (r.type !== 'delegated') return r
  const s = (r.session && deck.sessions.find(x => x.id === r.session)) || deck.taskSession(r.label)
  // No session of its own (helpers on other providers never load the mod): the server's state decides,
  // which it corrects from T3's run records once the helper finished.
  if (!s) return r.now === 'done' ? r : { ...r, now: 'running' }
  const c = deck.helperMain(s.id)
  // Working = its own main conversation is mid-turn. The session's "working" count is only a fallback: it also counts
  // that session's background helper, which can stay "running" long after the helper finished.
  const working = !!s.isLive && (c ? c.now !== 'done' : (s.working ?? 0) > 0)
  const segs = c?.segments ?? []
  // The helper's own plan wins when it has one; otherwise the delegated run's.
  const ownPlan = !!c?.plan?.length
  return {
    ...r, session: s.id, now: working ? (c?.now && c.now !== 'done' ? c.now : 'running') : 'done', nowServer: c?.nowServer,
    usd: s.totalUsd ?? 0, costKnown: s.costKnown !== false,
    // Its session exists but hasn't done anything yet.
    queued: working && !!c && !segs.some(x => x.end > x.start) && !c.tokens,
    // When it finished: its last bit of work, else when its session last changed.
    endedAt: working ? undefined : r.endedAt ?? (Math.max(0, ...segs.map(x => x.end)) || s.updatedAt),
    // Live progress from the helper's own session: what it is doing now, and which planned steps are done.
    ...(c ? {
      nowAt: c.nowAt, nowText: c.nowText ?? (c.nowAt && typeof c.now === 'string' && !isStateWord(c.now) ? c.now : undefined),
      planDone: ownPlan ? c.planDone : r.planDone, planSource: ownPlan ? c.planSource : r.planSource, planNow: ownPlan ? c.planNow : r.planNow, short: c.short || r.short,
      segments: c.segments ?? [], mcp: c.mcp ?? {}, tokens: c.tokens ?? 0, model: c.model ?? r.model, effort: c.effort ?? r.effort,
      asks: c.asks?.length ? c.asks : r.asks,
      tasks: c.tasks?.length ? c.tasks : r.tasks, done: c.done?.length ? c.done : r.done, tasksAt: c.tasks?.length ? c.tasksAt : r.tasksAt,
      plan: ownPlan ? c.plan : r.plan, startedAt: Math.min(r.startedAt ?? Infinity, c.startedAt ?? Infinity),
    } : {}),
  }
}

// Resolved on this page but not yet in the server's data: drop its attention now.
function withoutResolved(r: Run): Run {
  if (!r.attention || !deck.resolving.size) return r
  const { sessionId, runId } = runRef(r)
  return deck.resolving.has(sessionId + ':' + runId) ? { ...r, attention: undefined } : r
}

// All sessions: an open T3 helper its chat has no row for (the chat's mod reloaded and lost its delegated runs) gets
// one, linked to its session by id. So a chat between turns whose helpers still work stays active, helpers shown.
function helperRows(snap: Snap, runs: Run[]): Run[] {
  if (snap.sessionId !== 'all' || !snap.helperMains) return []
  const linked = new Set(runs.filter(r => r.type === 'delegated' && r.session).map(r => r.session))
  const out: Run[] = []
  for (const id of Object.keys(snap.helperMains)) {
    const s = deck.sessions.find(x => x.id === id)
    if (linked.has(id) || !s?.parentId || !runs.some(r => r.id === `${s.parentId}:main`)) continue
    out.push(linkTask({ id: `${s.parentId}:helper:${id}`, type: 'delegated', parentId: `${s.parentId}:main`, sessionOf: s.parentId, label: s.rawTitle || s.title || 'Helper', session: id, startedAt: s.startedAt }))
  }
  return out
}

// `snap` is the session data the sections draw from (the last good one while the page fades it out).
export type Model = { snap: Snap; runs: Run[]; tree: Run[]; triage?: Run; kids: Map<string, Run[]>; roots: Run[] }
export function buildModel(snap: Snap): Model {
  const byId = new Map<string, Run>()
  // All sessions groups chats under a row per folder only when Settings → Folders is on; off, every chat is a top row.
  const folders = deck.prefs.folders
  for (const r of snap.runs ?? []) if (folders || r.type !== 'project') byId.set(r.id, linkTask(withoutResolved(r))) // the same id can appear twice; keep one
  const runs = [...byId.values()]
  runs.push(...helperRows(snap, runs))
  const triage = runs.find(r => r.id === 'triage' || r.type === 'triage')
  const tree = runs.filter(r => r !== triage)
  const hasMain = byId.has('main')
  const kids = new Map<string, Run[]>()
  const roots: Run[] = []
  for (const r of tree) {
    let p = r.id === 'main' ? null : r.parentId
    if (p == null || !byId.has(p) || p === r.id || p === triage?.id) p = r.id !== 'main' && hasMain ? 'main' : null
    if (p == null) roots.push(r)
    else (kids.get(p) ?? kids.set(p, []).get(p)!).push(r)
  }
  // Among siblings: needs attention, then working, then queued, then finished; then by start time.
  const rank = (r: Run) => needsYou(r) ? 0 : isWorking(r) ? 1 : isQueued(r) ? 2 : 3
  const byStart = (a: Run, b: Run) => rank(a) - rank(b) || (a.startedAt ?? 0) - (b.startedAt ?? 0)
  roots.sort((a, b) => Number(b.id === 'main') - Number(a.id === 'main') || byStart(a, b))
  for (const list of kids.values()) list.sort(byStart)
  return { snap, runs, tree, triage, kids, roots }
}

// Finished agents stay in Agents this long (full green ring), then move to Earlier agents.
const GRACE_MS = MINUTE

export type Visible = {
  gone: Set<string> // ids pruned from the live tree
  active: Set<string> // All sessions: chats with something working, queued or needing you
  kidsOf: (id: string) => Run[] // children still shown
  below: Map<string, number> // how many shown agents sit under each row
}
// Main conversations, projects, anything still working, queued or needing attention (and parents of those) stay.
// All sessions: only chats that are active now keep their tree.
export function visibleTree(m: Model, isAll: boolean): Visible {
  const base = (r: Run) => isMainRow(r) || r.type === 'project' || r.now !== 'done' || needsYou(r) || Date.now() - finishedAt(r) < GRACE_MS
  const active = new Set(isAll ? m.tree.filter(r => r.sessionOf && (r.now !== 'done' || ATTN[r.attention ?? ''])).map(r => r.sessionOf!) : [])
  const stays = (r: Run) => !isAll ? base(r) : r.type !== 'project' && !!r.sessionOf && active.has(r.sessionOf) && base(r)
  const gone = new Set<string>()
  const prune = (r: Run): boolean => {
    let keep = stays(r)
    for (const k of m.kids.get(r.id) ?? []) keep = prune(k) || keep
    if (!keep) gone.add(r.id)
    return keep
  }
  m.roots.forEach(prune)
  const kidsOf = (id: string) => (m.kids.get(id) ?? []).filter(k => !gone.has(k.id))
  const below = new Map<string, number>()
  const count = (r: Run): number => {
    let n = 0
    for (const k of kidsOf(r.id)) n += 1 + count(k)
    below.set(r.id, n)
    return n
  }
  m.roots.forEach(count)
  return { gone, active, kidsOf, below }
}

// Earlier agents: every finished agent of the session, whatever kind, newest first. Live-tracked runs that left
// Agents, plus the ones rebuilt from the session's records; one row per id.
export function earlierAgents(m: Model, v: Visible, hist: Run[], isAll: boolean, win: Win): Run[] {
  const listed = new Set(m.runs.filter(r => !v.gone.has(r.id)).map(r => r.id))
  const past = [
    ...m.tree.filter(r => v.gone.has(r.id) && !isMainRow(r) && r.type !== 'project').map(r => ({ ...r, endedAt: finishedAt(r), live: true })),
    ...hist.filter(h => !listed.has(h.id)),
  ].filter((h, i, a) => a.findIndex(x => x.id === h.id) === i)
    .sort((a, b) => (Number(b.endedAt) || Number(b.startedAt) || 0) - (Number(a.endedAt) || Number(a.startedAt) || 0))
  // "Active" timeframe: only the chats working now.
  return isAll && win === 'active' ? past.filter(h => v.active.has(String(h.sessionOf))) : past
}
