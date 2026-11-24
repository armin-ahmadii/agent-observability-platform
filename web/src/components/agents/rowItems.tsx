// Builders for the keyed row lists. They return flat arrays of <Fold>s (a row, then its breakdown when opened),
// not components, because <Rows> animates only its direct children.
import { deck } from '../../data/store'
import { Icon } from '../../icons/Icon'
import { Logo, ModelName, Name, Marks } from '../common'
import { Breakdown } from '../breakdown/Breakdown'
import { Fold } from '../motion'
import { Count, Prog, RowAction, RowShell, SPIN_FRAC, StepRing, TitleNote } from './RowParts'
import { Ring } from '../Ring'
import { usd, tok, clock } from '../../lib/format'
import { isMainRow, isQueued, lastActivity, liveNow } from '../../lib/agents'
import type { Model, Visible } from '../../lib/tree'
import type { Chat, Run } from '../../lib/types'

const detailKey = (key: string) => key + '\u0000detail'
const plainLead = (r: { type?: string; model?: string }) => <div className="lead"><Logo r={r} /></div>
const costOf = (r: Run) => r.costKnown === false ? '—' : usd(r.usd ?? 0)

// The live tree: every shown agent in order, children under their parent while it is unfolded.
export function liveRowItems({ m, v, isAll, now, mainUsd, earlierFor }: {
  m: Model; v: Visible; isAll: boolean; now: number; mainUsd: number; earlierFor: (sessionId: string) => React.ReactNode
}): JSX.Element[] {
  const t0 = Math.min(now - 1000, ...m.tree.map(r => r.startedAt ?? now))
  // All sessions: an orchestrator's "(N)" counts its agents still working (its finished ones are inside it).
  const busy = (x: Run): number => v.kidsOf(x.id).reduce((a, k) => a + Number(k.now !== 'done') + busy(k), 0)
  const items: JSX.Element[] = []
  const walk = (r: Run, depth: number) => {
    const working = r.now !== 'done'
    const kidsShown = v.kidsOf(r.id)
    const fold = kidsShown.length > 0
    const open = fold && deck.isOpen(r.id)
    const segs = (r.segments ?? []).filter(s => s.end > s.start)
    const end = working ? now : Math.max(r.startedAt ?? t0, Number(r.endedAt) || 0, ...segs.map(s => s.end))
    const sel = deck.detailOpen(r.id)
    const note = r.type === 'project' ? '' : liveNow(r)
    const cnt = isAll && isMainRow(r) ? busy(r) : v.below.get(r.id)!
    const sub = depth > 0 && r.type !== 'main' && !String(r.id).endsWith(':main')
    const cls = 'row' + (working ? ' working' : ' done') + (isQueued(r) ? ' queued' : '') + (sub ? ' sub' : '') +
      (fold ? ' parent' : '') + (open ? ' open' : '') + (sel ? ' sel' : '')
    const depthStyle = { '--d': depth } as React.CSSProperties
    items.push(<Fold key={r.id}><RowShell id={r.id} className={cls} sel={sel}
      lead={<div className="lead" style={depthStyle}>
        {Array.from({ length: depth }, (_, i) => <span key={i} className="g" />)}
        {fold
          ? <button className="lg" style={depthStyle} data-toggle={r.id} aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} subagents`}><Logo r={r} /><span className="cv"><Icon name="chev" /></span></button>
          : <Logo r={r} />}
      </div>}
      mid={<>
        {r.type === 'project' ? null : <ModelName model={r.model} col />}<TitleNote r={r} note={note} />{cnt ? <Count n={r.type === 'project' ? kidsShown.length : cnt} /> : null}<StepRing r={r} /><Marks r={r} />
        {!isMainRow(r) && r.type !== 'project' && !working ? <RowAction r={r} /> : null}
      </>}
      tokens={r.type === 'delegated' && !r.tokens ? '—' : tok(r.tokens ?? 0)}
      cost={r.id === 'main' ? usd(mainUsd) : costOf(r)} /></Fold>)
    if (sel) items.push(<Fold key={detailKey(r.id)}><Breakdown r={r} depth={depth} kidsOpen={open} end={end} after={isAll && isMainRow(r) ? earlierFor(String(r.sessionOf)) : undefined} /></Fold>)
    if (open) for (const k of kidsShown) walk(k, depth + 1)
  }
  for (const r of m.roots) if (!v.gone.has(r.id)) walk(r, 0)
  return items
}

// The background helper: openable like any agent (its breakdown lists the jobs it has done).
// On hover, what it is doing (or did last).
export function triageRowItems(r: Run, now: number): JSX.Element[] {
  const sel = deck.detailOpen(r.id)
  const named: Run = { ...r, label: 'Background helper', short: 'Background helper' }
  const note = r.doing || (r.segments?.length ? r.segments[r.segments.length - 1].label ?? '' : '')
  const items = [<Fold key={r.id}><RowShell id={r.id} className={'row triage' + (r.doing ? ' working' : ' done') + (sel ? ' sel' : '')} sel={sel}
    lead={plainLead(r)}
    mid={<><ModelName model={r.model} col /><TitleNote r={named} note={note} />
      {r.doing ? <span className="rx spin"><Ring className="pr" frac={SPIN_FRAC} hideEmpty /></span> : null}</>}
    tokens={tok(r.tokens ?? 0)} cost={costOf(r)} /></Fold>]
  if (sel) items.push(<Fold key={detailKey(r.id)}><Breakdown r={named} depth={0} kidsOpen={false} end={r.doing ? now : lastActivity(r)} /></Fold>)
  return items
}

// Earlier agents: finished rows (greyed), each with its breakdown when opened.
export function earlierRowItems(list: Run[]): JSX.Element[] {
  const out: JSX.Element[] = []
  for (const h0 of list) {
    const h: Run = { ...h0, now: 'done', past: !h0.live }
    const sel = deck.detailOpen(h.id)
    out.push(<Fold key={h.id}><RowShell id={h.id} className={'row done past' + (sel ? ' sel' : '')} sel={sel}
      lead={plainLead(h)}
      mid={<><ModelName model={h.model} col /><Name r={h} /><Prog r={h} /><Marks r={h} /><span className="kids">{clock(h.startedAt!)}</span></>}
      tokens={h.tokens ? tok(h.tokens) : '—'} cost={costOf(h)} /></Fold>)
    if (sel) out.push(<Fold key={detailKey(h.id)}><Breakdown r={h} depth={0} kidsOpen={false} end={h.endedAt ?? h.startedAt!} /></Fold>)
  }
  return out
}

// All sessions: chats used in the timeframe that aren't working now. One opens like an agent: its meta and lanes
// (from its session file, while one exists) and its earlier agents.
export function chatRowItems(chats: Chat[], earlierCount: (sessionId: string) => number, earlierFor: (sessionId: string) => React.ReactNode): JSX.Element[] {
  const items: JSX.Element[] = []
  for (const c of chats) {
    const r = chatRun(c), sel = deck.detailOpen(r.id), n = earlierCount(c.id)
    if (sel) deck.ensureChildSnap(c.id)
    const child = deck.childSnaps.get(c.id)
    const listed = deck.sessions.some(s => s.id === c.id)
    const full: Run = { ...(child?.runs?.find(x => x.id === 'main') ?? {}), ...r, now: 'done', tokens: c.tokens, usd: c.usd, session: listed ? c.id : undefined, lastAskAt: child?.lastAsk?.at }
    const segs = (full.segments ?? []).filter(s => s.end > s.start)
    items.push(<Fold key={'chat:' + c.id}><RowShell id={r.id} className={'row done past' + (sel ? ' sel' : '')} sel={sel}
      lead={plainLead(r)}
      mid={<><ModelName model={c.model} col /><Name r={r} />{n ? <Count n={n} /> : null}</>}
      tokens={c.tokens ? tok(c.tokens) : '—'} cost={usd(c.usd)} /></Fold>)
    if (sel) items.push(<Fold key={detailKey('chat:' + c.id)}><Breakdown r={full} depth={0} kidsOpen={false} end={Math.max(full.startedAt ?? c.last, c.last, ...segs.map(s => s.end))} after={earlierFor(c.id)} /></Fold>)
  }
  return items
}
export const chatRun = (c: Chat): Run => ({ id: `${c.id}:main`, sessionOf: c.id, label: c.title, model: c.model })
