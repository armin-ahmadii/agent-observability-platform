// The pieces of one agent row: the row frame and what sits beside its title.
import { useDeck } from '../../data/store'
import { Icon } from '../../icons/Icon'
import { Title } from '../common'
import { Ring } from '../Ring'
import { canResolve, runRef, isMainRow, isQueued, needsYou, plainName, shortOf, stepsOf } from '../../lib/agents'
import type { Run } from '../../lib/types'

// Every row in Agents, Earlier agents and Previous orchestrators: one focusable button-like line that opens its breakdown.
// The click and key handling sits on the list around it (see rowEvents.ts).
export function RowShell({ id, className, sel, lead, mid, tokens, cost }: {
  id: string; className: string; sel: boolean; lead: React.ReactNode; mid: React.ReactNode; tokens: React.ReactNode; cost: React.ReactNode
}) {
  return <div className={className} data-run={id} tabIndex={0} role="button" aria-expanded={sel}>
    {lead}
    <div className="mid">{mid}</div>
    <div className="num c-tok">{tokens}</div>
    <div className="num c-usd">{cost}</div>
    <div className="c-dchev"><span className="dchev" aria-hidden="true"><Icon name="dchev" /></span></div>
  </div>
}

// "(3)" beside a parent's name: its subagents.
export const Count = ({ n }: { n: number }) => <span className="cnt">({n})</span>

// "2/5" after the title in Earlier agents: how far through its own to-do list the agent got.
export function Prog({ r }: { r: Run }) {
  const t = r.tasks
  if (!t?.length) return null
  return <span className="prog">{t.filter(x => x.status === 'done').length}/{t.length}</span>
}

// Right after the title: a ring filled by steps done, and "x/y".
// Working with no steps: a slow spin. Queued: an empty dashed ring. Needs you: the alert colour.
// Finished (or every step done): full and green. A main conversation between turns with no steps shows none.
export const SPIN_FRAC = 0.25
export function StepRing({ r }: { r: Run }) {
  if (r.type === 'project') return null
  const st = stepsOf(r)
  const queued = isQueued(r), done = r.now === 'done'
  if (done && isMainRow(r) && !st) return null
  const complete = !!st && st.x >= st.y
  const state = needsYou(r) ? 'attn' : queued ? 'queued' : done || complete ? 'finished' : st ? 'steps' : 'spin'
  const frac = state === 'finished' ? (st && isMainRow(r) ? st.x / st.y : 1) : st ? st.x / st.y : state === 'spin' ? SPIN_FRAC : 0
  return <span className={'rx ' + state}><Ring className="pr" frac={frac} hideEmpty />{st && !queued ? <span className="xy">{st.x}/{st.y}</span> : null}</span>
}

// The title; on hover or keyboard focus the agent's own note about what it is doing takes its place.
export function TitleNote({ r, note }: { r: Run; note: string }) {
  return <span className={'name' + (note ? ' has-note' : '')}><span className="ttl">{plainName(r) ? shortOf(r) : <Title t={shortOf(r)} />}</span>{note ? <span className="nt-h">{note}</span> : null}</span>
}

// The row's action on hover/focus: Resolve for a finished agent that needs attention, else Save as helper.
export function RowAction({ r }: { r: Run }) {
  if (canResolve(r)) { const ref = runRef(r); return <button className="act res" data-resolve={ref.runId} data-resolve-session={ref.sessionId}>Resolve</button> }
  return <SaveButton r={r} />
}

// "Saving…" shows until the mod confirms, or gives up after this long.
const SAVE_TIMEOUT_MS = 8000
export function SaveButton({ r }: { r: Run }) {
  const deck = useDeck()
  if (r.savedAs) deck.saving.delete(r.id)
  const t = deck.saving.get(r.id)
  if (t && Date.now() - t > SAVE_TIMEOUT_MS) deck.saving.delete(r.id)
  if (deck.saving.has(r.id)) return <button className="act" disabled>Saving…</button>
  if (r.savedAs || r.helper || r.type === 'delegated') return null
  // An agent that did really well keeps its save button in view.
  const keep = deck.grades?.[r.id]?.grade === 'great'
  return <button className={'act' + (keep ? ' keep' : '')} data-save={r.id} aria-label="Save as helper"><Icon name="save" /><span>Save as helper</span></button>
}
