// Plan limits: the 5-hour limit as a bar in the session menu; at the top right, one ring for the subscription chosen in
// the usage card (Claude's weekly limit by default, or the ChatGPT plan's). Hover, click or focus on it opens the card.
import { useDeck } from '../../data/store'
import { Icon } from '../../icons/Icon'
import { whenReset } from '../../lib/format'
import type { CodexLimits, Limit, Subscription } from '../../lib/types'
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
  const claude = deck.limits.find(l => l.kind === 'seven_day')
  const gpt = codexMain(deck.codexLimits)
  // The chosen subscription, else Claude, else whichever has data.
  const shown: Subscription | null = deck.ring === 'chatgpt' && gpt ? 'chatgpt' : claude ? 'claude' : gpt ? 'chatgpt' : null
  setCard('usage', usageCardHtml(deck.limits, deck.limitsAt, deck.codexLimits, shown), action => {
    if (action === 'ring:claude' || action === 'ring:chatgpt') deck.setRing(action.slice(5) as Subscription)
  })
  const used = shown === 'chatgpt' ? gpt!.percentUsed : claude?.percentUsed
  if (used == null) return <div className="wk" />
  return (
    <div className="wk" data-card="usage" data-card-align="end" tabIndex={0} aria-label="Usage limits">
      {shown === 'chatgpt' && <span className="logo light"><Icon name="m_openai" /></span>}
      <UsageRing percentUsed={used} />
      <span className="t"><b>{left(used)}% left</b>{shown === 'claude' && <span className="wk-x"> this week</span>}</span>
    </div>
  )
}
