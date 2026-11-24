// All sessions: which timeframe the numbers cover. A segmented control (radio group) with arrow-key moves.
import { useDeck } from '../../data/store'
import { WINS, type Win } from '../../lib/types'

export const WIN_LABEL: Record<Win, string> = { active: 'Active', '24h': '24h', '7d': '7d', '30d': '30d' }

export function WinPicker() {
  const deck = useDeck()
  const onKey = (e: React.KeyboardEvent) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const w = WINS[(WINS.indexOf(deck.win) + step + WINS.length) % WINS.length]
    deck.setWin(w)
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`.win [data-w="${w}"]`)?.focus())
  }
  return <div className="win-bar"><div className="win" role="radiogroup" aria-label="Timeframe" onKeyDown={onKey}>
    {WINS.map(w => <button key={w} data-w={w} role="radio" aria-checked={deck.win === w} tabIndex={deck.win === w ? 0 : -1} onClick={() => deck.setWin(w)}>{WIN_LABEL[w]}</button>)}
  </div></div>
}
