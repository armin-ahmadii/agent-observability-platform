// An opened agent: heading, checklist, brief, handed-back result, meta line, View details, thumbs, and the lanes timeline.
import { useLayoutEffect, useRef, useState, useEffect } from 'react'
import { useDeck } from '../../data/store'
import { Thumbs } from '../common'
import { dur, tok, clock } from '../../lib/format'
import { modelInfo } from '../../lib/models'
import { ENDED_BADLY, effortOf, ctxPct, memId, listOf } from '../../lib/agents'
import type { Run } from '../../lib/types'
import { Checklist } from './Checklist'
import { Lanes } from './Lanes'
import { MdLite } from './MdLite'

// A clamped paragraph; "Show more" appears only when the text is cut off.
function Clamp({ id, className, children }: { id: string; className: string; children: React.ReactNode }) {
  const deck = useDeck()
  const all = deck.briefOpen.has(id)
  const p = useRef<HTMLParagraphElement>(null)
  const [cut, setCut] = useState(false)
  const measure = () => { const el = p.current; if (el && !all) setCut(el.scrollHeight > el.clientHeight + 1) }
  useLayoutEffect(measure)
  useEffect(() => { addEventListener('resize', measure); return () => removeEventListener('resize', measure) })
  return <>
    <p ref={p} className={className + (all ? ' all' : '')}>{children}</p>
    <button className="more" data-more={id} hidden={!all && !cut}>{all ? 'Show less' : 'Show more'}</button>
  </>
}

// The tree guide lines on the left, so the breakdown lines up under its row's title.
const LEAD_PAD_PX = 28
const LEAD_PAD_UNDER_KIDS_PX = 6

export function Breakdown({ r, depth, kidsOpen, end, after }: { r: Run; depth: number; kidsOpen: boolean; end: number; after?: React.ReactNode }) {
  const deck = useDeck()
  const brief = (r.brief ?? '').trim()
  const result = r.now === 'done' ? String(r.result ?? '').trim() : ''
  const showBrief = !!brief && brief !== r.label
  const list = listOf(r)
  const promptOpen = deck.briefOpen.has(r.id + ':prompt')
  const eff = effortOf(r)
  const pct = ctxPct(r)
  const meta = [
    modelInfo(r.model).full,
    eff && eff + ' effort',
    r.startedAt && 'Started ' + clock(r.startedAt),
    r.startedAt && (r.now !== 'done' ? 'Running for ' : 'Ran for ') + dur(end - r.startedAt),
    pct != null && `Memory ${pct}% full`,
  ].filter(Boolean) as string[]
  const mem = r.type === 'triage' || r.type === 'project' ? null : memId(r)
  return (
    <div className="detail">
      <div className="d-lead" style={after ? { gridRow: '1 / span 5' } : undefined}>
        {Array.from({ length: depth }, (_, i) => <span key={i} className="g" />)}
        {kidsOpen ? <><span className="g" /><span className="pad" style={{ width: LEAD_PAD_UNDER_KIDS_PX }} /></> : <span className="pad" style={{ width: LEAD_PAD_PX }} />}
      </div>
      <div className="d-text">
        <h3>{r.label}</h3>
        {list && <Checklist list={list} planDone={r.planDone} planNow={r.planNow} failed={r.now === 'done' && ENDED_BADLY.includes(r.attention ?? '')} />}
        {showBrief && <button className="more" data-more={r.id + ':prompt'}>{promptOpen ? 'Hide prompt' : 'Show prompt'}</button>}
        {showBrief && promptOpen && <Clamp id={r.id} className="brief">{brief}</Clamp>}
        {result && <Clamp id={r.id + ':result'} className="brief res"><MdLite text={result} /></Clamp>}
      </div>
      <div className="d-meta">
        <span className="d-info">
          {meta.map((x, i) => <span key={i}>{x}{i < meta.length - 1 ? ' ·' : ''}</span>).flatMap((x, i) => i ? [' ', x] : [x])}
          {/* Narrow panels hide the Tokens column, so the count shows here instead. */}
          {r.tokens ? <> <span className="m-tok">· {tok(r.tokens)} tokens</span></> : null}
        </span>
        {(!!r.session || !!mem) && <span className="d-act">
          {r.session && <button className="more view" data-view={r.session}>View details</button>}
          {mem && <Thumbs a={{ id: mem.id, label: String(r.id).endsWith('main') ? 'Main conversation' : r.label ?? '', model: r.model, kind: mem.kind }} sessionId={mem.sid} />}
        </span>}
      </div>
      <Lanes r={r} end={end} />
      {/* All sessions: an orchestrator's own finished agents, folded, at the end of its breakdown. */}
      {after ? <div className="d-after">{after}</div> : null}
    </div>
  )
}
