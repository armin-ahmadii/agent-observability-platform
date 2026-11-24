// Tasks: each of your recent requests and where it went, as a small tree in the Agents row style:
// the request (one line) and its state, the agents it went to, and the subagents they started for it.
// Clicking an agent scrolls to its row (or Earlier agents); the row itself stays as it was.
import { useDeck } from '../data/store'
import { Logo, ModelName, ShowMore, Title } from './common'
import { Appear, Fold, Rows } from './motion'
import { cleanMsg } from '../lib/format'
import { isMainRow, isQueued, isWorking, shortOf } from '../lib/agents'
import type { Model } from '../lib/tree'
import { isAsk, runForRoute } from '../lib/routes'
import type { Ask, Route, Run } from '../lib/types'

// Requests shown before "+N more".
const TOP = 5
type Node = { key: string; depth: number; run: Run | null; route?: Route; open?: string }
type State = 'queued' | 'working' | 'done'
const WORD: Record<State, string> = { queued: 'Queued', working: 'Working', done: 'Done' }

function treeOf(a: Ask, next: Ask | undefined, runs: Run[], childRuns: (r: Run) => Run[]): { nodes: Node[]; state: State } {
  const seen = new Set<string>()
  const routed: { rt: Route; r: Run | null }[] = []
  for (const rt of a.routedTo ?? []) {
    const r = runForRoute(rt, runs)
    const k = r?.id ?? rt.runId
    if (seen.has(k)) continue
    seen.add(k)
    routed.push({ rt, r })
  }
  const ids = new Set(routed.map(x => x.r?.id).filter(Boolean) as string[])
  const main = runs.find(r => r.id === 'main') ?? null
  const nodes: Node[] = []
  const all: Run[] = []
  // A routed agent sits under the routed agent that started it; subagents the main conversation started sit under it.
  const under = (pid: string) => routed.filter(x => x.rt.kind === 'subagent' && x.r && (x.r.parentId ?? 'main') === pid && x.r.id !== pid)
  const add = (r: Run | null, depth: number, rt?: Route, open?: string) => {
    nodes.push({ key: (r?.id ?? rt?.runId ?? '') + ':' + depth, depth, run: r, route: rt, open: open ?? r?.id })
    if (!r) return
    all.push(r)
    for (const x of under(r.id)) add(x.r, depth + 1, x.rt)
    // A T3 helper's own subagents for this request (from its session), opening the helper's row.
    if (r.type === 'delegated') for (const k of childRuns(r).filter(k => (k.startedAt ?? 0) >= a.at && (!next || (k.startedAt ?? 0) < next.at))) {
      nodes.push({ key: r.id + '>' + k.id, depth: depth + 1, run: k, open: r.id })
      all.push(k)
    }
  }
  const top = routed.filter(x => !(x.r && x.rt.kind === 'subagent' && ids.has(x.r.parentId ?? '') && x.r.parentId !== x.r.id))
  const fromMain = top.filter(x => x.rt.kind === 'subagent' && x.r && (x.r.parentId ?? 'main') === 'main')
  if ((fromMain.length || !top.length) && main) add(main, 1)
  for (const x of top) if (!fromMain.includes(x)) add(x.r, 1, x.rt)
  // Older requests without an end time were answered before the next one came in.
  const answered = !!a.answeredAt || !!next
  const agents = all.filter(r => !isMainRow(r))
  const state: State = agents.some(isWorking) || (!answered && !agents.some(isQueued)) ? 'working'
    : agents.some(isQueued) ? 'queued' : 'done'
  return { nodes, state }
}

function AgentLine({ n }: { n: Node }) {
  const deck = useDeck()
  const r = n.run
  const model = r?.model ?? n.route?.model
  const raw = n.route && /^thread:|%3A/.test(n.route.label) ? 'Earlier helper' : n.route?.label ?? ''
  const title = r ? (r.id === 'main' ? 'Main conversation' : shortOf(r)) : raw
  const body = <>
    <span className="lead">{Array.from({ length: n.depth }, (_, i) => <span key={i} className="g" />)}<Logo r={{ type: r?.type, model }} /></span>
    <ModelName model={model} />
    <span className="t"><Title t={title} /></span>
  </>
  return n.open ? <button className="req-a" onClick={() => deck.reveal(n.open!)}>{body}</button> : <span className="req-a">{body}</span>
}

export function Requests({ m, show }: { m: Model; show: boolean }) {
  const deck = useDeck()
  const snap = m.snap
  const asks = snap.sessionId === 'all' ? [] : [snap.lastAsk, ...(snap.recentAsks ?? [])].filter(isAsk)
    .filter((a, i, l) => l.findIndex(x => x.at === a.at) === i).sort((a, b) => b.at - a.at)
  const runs = [...m.runs, ...deck.agentRows.filter(h => !m.runs.some(r => r.id === h.id)).map(h => ({ ...h, now: 'done', past: true }))]
  const childRuns = (r: Run) => (r.session && deck.childSnaps.get(String(r.session))?.runs?.filter(k => k.id !== 'main' && k.id !== 'triage' && k.type !== 'triage')) || []
  const block = (a: Ask, i: number) => {
    const { nodes, state } = treeOf(a, asks[i - 1], runs, childRuns)
    return <Fold key={a.at}><div className="req">
      <div className="req-q"><span className="q">{cleanMsg(a.text)}</span><span className={'req-st ' + state}>{WORD[state]}</span></div>
      {nodes.map(n => <AgentLine key={n.key} n={n} />)}
    </div></Fold>
  }
  const more = deck.asksOpen
  return <Appear>{show && asks.length > 0 && <section className="sec reqs">
    <div className="head"><h2>Tasks</h2></div>
    <div className="req-list"><Rows>{asks.slice(0, TOP).map(block)}</Rows></div>
    <Appear>{more && asks.length > TOP && <div className="req-list"><Rows>{asks.slice(TOP).map((a, i) => block(a, i + TOP))}</Rows></div>}</Appear>
    {asks.length > TOP && <ShowMore open={more} hiddenCount={asks.length - TOP} onToggle={() => deck.toggleAsks()} />}
  </section>}</Appear>
}
