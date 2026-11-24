// Where your messages went: each message (Ask) lists the agents it was routed to (Route), and these find their rows.
import { localId } from './ids'
import type { Ask, Route, Run, Snap } from './types'

// T3 "Delegated task node" notices are not your messages.
export const isAsk = (a?: Ask | null): a is Ask => !!a && !!a.text && !/^Delegated task node[:\s]/.test(a.text)

// A route names a run id; a follow-up to a T3 helper names its thread instead, so match the delegated run that opened
// that thread. A route that knows the helper's own session matches the run linked to it.
export function runForRoute(rt: Route, runs: Run[]): Run | null {
  const hit = runs.find(r => localId(r) === rt.runId || r.id === rt.runId)
  if (hit) return hit
  if (rt.sessionId) {
    const bySession = runs.find(r => r.type === 'delegated' && r.session === rt.sessionId)
    if (bySession) return bySession
  }
  let id = rt.runId
  try { id = decodeURIComponent(id) } catch {}
  return runs.filter(r => r.childThreadId && id.startsWith(r.childThreadId))
    .sort((a, b) => b.childThreadId!.length - a.childThreadId!.length || (b.startedAt ?? 0) - (a.startedAt ?? 0))[0] ?? null
}

export type Sent = { sessionId: string; ask: Ask }
// Your messages, newest first: the shown session's, or in All sessions every listed chat's (the server sends each
// chat's last few as `recentAsks: { [sessionId]: Ask[] }`).
export function sentMessages(snap: Snap): Sent[] {
  const out: Sent[] = []
  if (snap.sessionId === 'all') {
    const by = snap.recentAsks as unknown
    if (by && typeof by === 'object' && !Array.isArray(by)) for (const [sid, list] of Object.entries(by as Record<string, Ask[]>)) for (const a of list ?? []) out.push({ sessionId: sid, ask: a })
  } else {
    for (const a of [snap.lastAsk, ...(snap.recentAsks ?? [])]) if (a) out.push({ sessionId: snap.sessionId, ask: a })
  }
  return out.filter(x => isAsk(x.ask)).filter((x, i, l) => l.findIndex(y => y.sessionId === x.sessionId && y.ask.at === x.ask.at) === i)
    .sort((a, b) => b.ask.at - a.ask.at)
}

// The rows a message landed in: each route's agent, or the chat's main row when the chat handled it itself.
// `runs` are the shown model's runs; in All sessions only the message's own chat's runs count.
export function targetsOf(s: Sent, runs: Run[], isAll: boolean): Run[] {
  const mine = isAll ? runs.filter(r => r.sessionOf === s.sessionId) : runs
  const main = mine.find(r => isAll ? r.id === `${s.sessionId}:main` : r.id === 'main')
  const out: Run[] = []
  for (const rt of s.ask.routedTo ?? []) {
    const r = runForRoute(rt, mine)
    if (r && !out.includes(r)) out.push(r)
  }
  if (!out.length && s.ask.answeredAt && main) out.push(main)
  return out
}
