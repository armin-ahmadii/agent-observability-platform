// Saved helpers with their on/off switch.
import { useDeck } from '../data/store'
import { plural } from '../lib/format'

// A switch shows the wanted state until the mod confirms it, or gives up after this long.
const TOGGLE_TIMEOUT_MS = 6000

export function Helpers() {
  const deck = useDeck()
  const helpers = deck.snap?.helpers ?? []
  if (!helpers.length) return null
  return (
    <section className="sec">
      <div className="head"><h2>Saved helpers</h2></div>
      <div>
        {helpers.map(h => {
          const t = deck.toggling.get(h.name)
          if (t && (t.on === h.isOn || Date.now() - t.at > TOGGLE_TIMEOUT_MS)) deck.toggling.delete(h.name)
          const on = deck.toggling.get(h.name)?.on ?? h.isOn
          const tags = [h.swarm && 'swarm', h.model, h.notes?.length && plural(h.notes.length, 'note', 'notes'), h.uses && `used ${h.uses}×`].filter(Boolean)
          return (
            <div key={h.name} className="hlp">
              <div className="name">{h.name}</div>
              <div className="tags">{tags.join(' · ')}</div>
              <div className="sw"><button className="tog" role="switch" aria-checked={!!on} aria-label={h.name} onClick={() => deck.toggleHelper(h.name, !!on)} /></div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
