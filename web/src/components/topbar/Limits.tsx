// Plan limits: the 5-hour limit as a bar in the session menu; at the top right, a ring for Claude's weekly limit and
// (when Codex has reported one) a ring for the ChatGPT plan's. Hovering or focusing the rings opens the usage card.
import { useDeck } from '../../data/store'
import { Icon } from '../../icons/Icon'
import { whenReset } from '../../lib/format'
import type { CodexLimits, Limit } from '../../lib/types'
import { Ring } from '../Ring'
import { setCard } from '../Tooltip'
import { usageCardHtml, HOT_PCT } from './usageCard'

const left = (percentUsed: number) => Math.max(0, Math.round(100 - percentUsed))

export function SessionLimit({ limits }: { limits: Limit[] }) {
  const five = limits.find(l => l.kind === 'five_hour')
  if (!five) return null
  return <div className="lims">
    <div className="lim">
      <div className="lim-t"><span>Session limit</span><b>{left(five.percentUsed)}% left</b><em>{whenReset(five.resetsAt)}</em></div>
      <div className="lim-bar"><i style={{ width: `${Math.min(100, five.percentUsed)}%` }} className={five.percentUsed >= HOT_PCT ? 'hot' : undefined} /></div>
    </div>
  </div>
}

// The ChatGPT ring shows its weekly window, else its longest one.
const codexMain = (c: CodexLimits | null) => c?.limits.find(l => l.minutes === 10080) ?? [...(c?.limits ?? [])].sort((a, b) => (b.minutes ?? 0) - (a.minutes ?? 0))[0]

function UsageRing({ percentUsed }: { percentUsed: number }) {
  return <Ring className="ring" frac={Math.min(100, percentUsed) / 100} fgClass={'fg' + (percentUsed >= HOT_PCT ? ' hot' : '')} hideEmpty />
}

export function UsageRings() {
  const deck = useDeck()
  const wk = deck.limits.find(l => l.kind === 'seven_day')
  const gpt = codexMain(deck.codexLimits)
  setCard('usage', usageCardHtml(deck.limits, deck.limitsAt, deck.codexLimits))
  if (!wk && !gpt) return <div className="wk" />
  return (
    <div className="wk" data-card="usage" data-card-align="end" tabIndex={0} aria-label="Usage limits">
      {wk && <span className="wk-i">
        <UsageRing percentUsed={wk.percentUsed} />
        <span className="t"><b>{left(wk.percentUsed)}%<span className="wk-l"> left</span></b><span className="wk-x"> this week</span></span>
      </span>}
      {gpt && <span className="wk-i">
        <span className="logo light"><Icon name="m_openai" /></span>
        <UsageRing percentUsed={gpt.percentUsed} />
        <span className="t"><b>{left(gpt.percentUsed)}%<span className="wk-l"> left</span></b></span>
      </span>}
    </div>
  )
}
