// The timeline under an opened agent: one lane per kind of work, always in the same order, on a shared time axis.
// A server's stretches sit in the lane for what it was used for (Paper edits → Designing).
import { Icon } from '../../icons/Icon'
import { dur, tok } from '../../lib/format'
import { ACTS, VERB } from '../../lib/agents'
import { actOf, mergeSegs } from '../../lib/segments'
import { serverLabel } from '../../lib/servers'
import type { Run, Segment } from '../../lib/types'

type Lane = { act: string; label: string; bars: Segment[]; ms: number; tokens: number }
// The axis is at least this long, so a run that just started doesn't stretch one blip across the whole bar.
const MIN_SPAN_MS = 1000

export function Lanes({ r, end }: { r: Run; end: number }) {
  const raw = (r.segments ?? []).filter(s => s.end > s.start).sort((a, b) => a.start - b.start)
  const s0 = Math.min(r.startedAt ?? end, ...raw.map(s => s.start))
  const span = Math.max(MIN_SPAN_MS, end - s0)
  const pct = (t: number) => Math.min(100, Math.max(0, (t - s0) / span * 100))
  const lanes = new Map<string, Lane>()
  for (const s of mergeSegs(raw, span)) {
    const a = actOf(s)
    const l = lanes.get(a) ?? lanes.set(a, { act: a, label: VERB[a] ?? a, bars: [], ms: 0, tokens: 0 }).get(a)!
    l.ms += s.end - s.start
    l.tokens += s.tokens ?? 0
    l.bars.push(s)
  }
  return <div className="d-time">
    {ACTS.filter(a => lanes.has(a)).map(a => lanes.get(a)!).map(l => (
      <div key={l.act} className="lane" style={{ '--c': `var(--a-${l.act})` } as React.CSSProperties}>
        <div className="who"><Icon name={l.act} /><b>{l.label}</b></div>
        <div className="track">{l.bars.map((s, i) => (
          <i key={i} style={{ left: `min(${pct(s.start).toFixed(2)}%, calc(100% - 3px))`, width: `${(pct(s.end) - pct(s.start)).toFixed(2)}%` }}
            data-tip={s.server ? `${l.label} in ${serverLabel(s.server)}` : l.label} data-sub={dur(s.end - s.start) + (s.tokens ? ' · ' + tok(s.tokens) + ' tokens' : '')} />
        ))}</div>
        <div className="num">{l.ms ? dur(l.ms) : '—'}</div><div className="num l-tok">{l.tokens ? tok(l.tokens) : ''}</div>
      </div>
    ))}
  </div>
}
