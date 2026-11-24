// Small pieces used in several areas: model logo, model name, two-tone names, status markers, thumbs, "+N more".
import { Icon, AppIcon } from '../icons/Icon'
import { modelInfo } from '../lib/models'
import { ATTN, ctxPct, shortOf, plainName } from '../lib/agents'
import { useDeck } from '../data/store'
import type { Run } from '../lib/types'

export function Logo({ r }: { r: { type?: string; model?: string } }) {
  if (r.type === 'project') return <span className="logo none folder"><Icon name="folder" /></span>
  const mi = modelInfo(r.model)
  const cls = !mi.color ? ' none' : mi.color === 'light' ? ' light' : mi.color === 'app' ? ' app' : ''
  const style = mi.color && mi.color !== 'light' && mi.color !== 'app' ? ({ '--c': mi.color } as React.CSSProperties) : undefined
  return <span className={'logo' + cls} style={style}>{mi.icon === 'app_muse' ? <AppIcon app="muse" /> : <Icon name={mi.icon} />}</span>
}

// The model's short name ("Opus 5.5") right after the logo, before the title, grey; hidden at ≤380px.
// In agent rows (col) it is a fixed-width column so every title starts at the same x; longer names are cut.
export function ModelName({ model, col }: { model?: string; col?: boolean }) {
  const { name } = modelInfo(model)
  if (col) return <span className="mdl col">{name}</span>
  return name ? <span className="mdl">{name}</span> : null
}

// "Build: fix pass features" → the action word in full black, the rest lighter.
export function Title({ t }: { t: string }) {
  const m = /^(\w+):\s*(.*)$/.exec(t)
  return m ? <>{m[1]}: <span className="desc">{m[2]}</span></> : <>{t}</>
}
// The row name: the short title.
export function Name({ r }: { r: Run }) {
  return <span className="name">{plainName(r) ? shortOf(r) : <Title t={shortOf(r)} />}</span>
}

// Markers beside the name: needs attention, memory nearly full, did really well.
// Only the attention marker has a tooltip (why it needs you); the others say it in their label.
function Mk({ cls, icon, label, why }: { cls: string; icon: string; label: string; why?: string }) {
  return <span className={'mk ' + cls} role="img" aria-label={label + (why ? ': ' + why : '')} data-tip={why === undefined ? undefined : label} data-sub={why || undefined}><Icon name={icon} /></span>
}
// Why it needs attention, in 7 words or fewer.
const WHY: Record<string, string> = {
  stopped: 'Ended early by you or main chat',
  failed: 'Crashed before it could finish',
  error: 'The model returned an error or refused',
  waiting: 'Needs your answer to keep going',
}
// The memory marker shows from this share of the context window.
const CONTEXT_WARN_PCT = 80
export function Marks({ r }: { r: Run }) {
  const deck = useDeck()
  const g = r.now === 'done' ? deck.grades?.[r.id] : null
  const pct = ctxPct(r)
  return <>
    {ATTN[r.attention ?? ''] && <Mk cls="alert" icon="alert" label={ATTN[r.attention!]} why={WHY[r.attention!] ?? ''} />}
    {pct != null && pct >= CONTEXT_WARN_PCT && <Mk cls="warn" icon="gauge" label={`Memory ${pct}% full`} />}
    {g?.grade === 'great' && <Mk cls="great" icon="star" label={g.why || 'Did really well'} />}
  </>
}

// Thumbs up/down on an agent (one vote each; clicking the same thumb again removes it).
export function Thumbs({ a, sessionId }: { a: { id: string; label: string; model?: string; kind: string }; sessionId: string }) {
  const deck = useDeck()
  const cur = (deck.memory?.agents ?? []).find(x => x.id === a.id)?.thumb ?? 0
  const vote = (score: number) => (e: React.MouseEvent) => {
    e.stopPropagation()
    deck.vote({ vsid: sessionId, id: a.id, label: a.label, model: a.model, kind: a.kind, score })
  }
  return <span className="thumbs">
    <button className={'thumb' + (cur > 0 ? ' on' : '')} data-vote="1" aria-label="Thumbs up" onClick={vote(1)}><Icon name="tup" /></button>
    <button className={'thumb' + (cur < 0 ? ' on bad' : '')} data-vote="-1" aria-label="Thumbs down" onClick={vote(-1)}><Icon name="tdown" /></button>
  </span>
}

// "+3 more" / "Show less" under a list cut to its first few items (Tasks, Project memory).
export function ShowMore({ open, hiddenCount, onToggle, hidden }: { open: boolean; hiddenCount: number; onToggle: () => void; hidden?: boolean }) {
  return <button className="hist-h mem-more" aria-expanded={open} hidden={hidden} onClick={onToggle}>
    <span className="cv"><Icon name="chev" /></span><span className="t">{open ? 'Show less' : `+${hiddenCount} more`}</span></button>
}
