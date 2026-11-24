// Plan limits: the 5-hour limit as a bar in the session menu, the weekly limit as the ring at the top right.
import { whenReset } from '../../lib/format'
import type { Limit } from '../../lib/types'
import { Ring } from '../Ring'

// From this share used, bars and the ring turn the warning colour.
const HOT_PCT = 80
const left = (l: Limit) => Math.max(0, Math.round(100 - l.percentUsed))

export function SessionLimit({ limits }: { limits: Limit[] }) {
  const five = limits.find(l => l.kind === 'five_hour')
  if (!five) return null
  return <div className="lims">
    <div className="lim">
      <div className="lim-t"><span>Session limit</span><b>{left(five)}% left</b><em>{whenReset(five.resetsAt)}</em></div>
      <div className="lim-bar"><i style={{ width: `${Math.min(100, five.percentUsed)}%` }} className={five.percentUsed >= HOT_PCT ? 'hot' : undefined} /></div>
    </div>
  </div>
}

export function WeekRing({ limits }: { limits: Limit[] }) {
  const wk = limits.find(l => l.kind === 'seven_day')
  if (!wk) return <div className="wk" />
  return (
    <div className="wk">
      <Ring className="ring" frac={Math.min(100, wk.percentUsed) / 100} fgClass={'fg' + (wk.percentUsed >= HOT_PCT ? ' hot' : '')} />
      <span className="t"><b>{left(wk)}% left</b><span className="wk-x"> this week</span></span>
    </div>
  )
}
