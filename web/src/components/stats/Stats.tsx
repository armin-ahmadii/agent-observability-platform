// Stat boxes: cost estimate (with pace and the saved-copy warning) and tokens; the cost card opens on hover/focus.
import { useDeck } from '../../data/store'
import { usd, tok, MINUTE } from '../../lib/format'
import type { Model } from '../../lib/tree'
import type { Win } from '../../lib/types'
import { setCard } from '../Tooltip'
import { Appear } from '../motion'
import { costCardHtml, dayCardHtml } from './costCard'
import { WinPicker, WIN_LABEL } from './WinPicker'

// Pace shows from this much spent in the last 10 minutes; the cache warning in its last 10 minutes.
const MIN_PACE_USD = 0.01
const CACHE_WARN_MS = 10 * MINUTE

export function Stats({ m, show }: { m: Model; show: boolean }) {
  const deck = useDeck()
  const snap = m.snap
  // All sessions shows the chosen timeframe across every chat; one session shows its own totals.
  const day = snap.sessionId === 'all' ? snap.day : undefined
  const lbl = WIN_LABEL[(day?.win ?? '24h') as Win] ?? '24h'
  const total = day ? day.usd : snap.totalUsd ?? 0
  setCard('cost', day ? dayCardHtml(day) : costCardHtml(m, total))
  if (!show) return <Appear>{null}</Appear>
  // Under the number: how fast it is climbing, and a warning shortly before the saved copy of the conversation expires.
  const mm = deck.math?.id === snap.sessionId ? deck.math : null
  const left = (mm?.cache?.until ?? 0) - Date.now()
  const pace = (mm?.pace?.last10 ?? 0) >= MIN_PACE_USD, exp = left > 0 && left <= CACHE_WARN_MS
  return <Appear>
    {day && <WinPicker />}
    <div className={'stats' + (day ? ' has-win' : '')}>
      <div className="stat">
        {/* The cost card opens only from the label itself. */}
        <div className="k"><span data-card="cost" id="s-cost" tabIndex={0}>{day ? 'Cost · ' + lbl : 'Cost estimate'}</span></div>
        {/* A new timeframe fades its numbers in; live refreshes keep the same key, so they never animate. */}
        <div className="v" id="s-usd" key={'u' + (day?.win ?? '')}><i>≈</i>{usd(total)}</div>
        <Appear>{(pace || exp) && <div className="s">
          {pace && <span>+{usd(mm!.pace!.last10)} last 10 min</span>}
          {exp && <span className="exp">saved copy expires in {Math.ceil(left / MINUTE)}m</span>}
        </div>}</Appear>
      </div>
      <div className="stat"><div className="k">{day ? 'Tokens · ' + lbl : 'Tokens'}</div><div className="v" id="s-tok" key={'t' + (day?.win ?? '')}>{tok(day ? day.tokens : m.runs.reduce((a, r) => a + (r.tokens ?? 0), 0))}</div></div>
    </div>
  </Appear>
}
