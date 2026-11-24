// Tasks asked to show an agent (deck.reveal): unfold its parents (or Earlier agents) until its row exists, then scroll to it.
import { useEffect } from 'react'
import { useReducedMotion } from 'motion/react'
import { deck } from '../../data/store'
import type { Model, Visible } from '../../lib/tree'
import type { Run } from '../../lib/types'

// Wait for the breakdown (and any list that just unfolded) to finish opening, so the scroll lands on its final place.
const SETTLE_MS = 300

export function useReveal(m: Model, v: Visible, past: Run[], showAgents: boolean) {
  const reduce = useReducedMotion()
  useEffect(() => {
    const id = deck.revealing
    if (!id) return
    const el = document.querySelector<HTMLElement>(`[data-run="${CSS.escape(id)}"]`)
    if (el) {
      deck.revealing = null
      el.focus({ preventScroll: true })
      setTimeout(() => el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' }), reduce ? 0 : SETTLE_MS)
      return
    }
    const live = m.tree.find(r => r.id === id)
    if (live && !v.gone.has(id)) {
      const parentOf = (x: string) => [...m.kids].find(([, ks]) => ks.some(k => k.id === x))?.[0]
      let opened = false
      for (let p = parentOf(id); p; p = parentOf(p)) if (!deck.isOpen(p)) { deck.openState[deck.openKey(p)] = true; opened = true }
      if (!showAgents || !opened) deck.revealing = null
      if (opened) deck.render()
      return
    }
    if (past.some(h => h.id === id) && !deck.histOpen) return deck.toggleHist()
    deck.revealing = null
  })
}
