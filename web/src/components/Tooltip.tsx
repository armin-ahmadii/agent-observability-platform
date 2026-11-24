// The one tooltip on the page, used for four things: two cards (the cost card, opened from the "Cost estimate" words in
// Stats, and the usage card, opened from the usage rings at the top right), why an agent needs attention (its red
// marker), and the activity bars in an opened agent's lanes (data-tip + data-sub, e.g. "Thinking" / "23s · 53k tokens").
// A card opens from an element with data-card="<name>" (its HTML comes from setCard) on hover, click/tap or keyboard
// focus. A card may hold choices: elements with data-action="…" (tabindex 0) run the card's onAction on click,
// Enter or Space; Tab from the trigger moves into them.
// Tips sit above their anchor, or below when there is no room; cards open below. Nothing leaves the window.
// Kept imperative on purpose: it follows the mouse and must not re-render the app.
import { useEffect, useRef } from 'react'
import { escapeHtml as esc } from '../lib/format'

// Tips longer than this (title + sub) stack their two lines instead of sitting side by side.
const LONG_TIP_CHARS = 44
const EDGE = 8 // px kept clear of the window edge
const GAP = 6 // px between the anchor and the tip
const INSTANT_AFTER_MS = 300 // reopening this soon after closing skips the fade
const CARD_LINGER_MS = 200 // a card waits this long for the pointer to reach it
const CARD_MIN_HEIGHT = 120
const CARD_SCROLL_STEP = 48 // px per arrow key while the card has focus

let tip: HTMLDivElement | null = null
let html = ''
const cards: Record<string, string> = {} // card name → its HTML
const actions: Record<string, (action: string) => void> = {} // card name → what its data-action choices do
const mouse = { x: 0, y: 0 }
let cardOn = false, cardTimer = 0
let cardEl: HTMLElement | null = null // the trigger of the open card
let redrawing = false
let hidAt = 0 // when the tooltip last closed: reopening right after skips the fade, so moving along a row feels instant
const cardTrigger = (el: Element | null) => el?.closest?.<HTMLElement>('[data-card]') ?? null

function setHTML(s: string) { if (tip && html !== s) { tip.innerHTML = s; html = s } }
/** Each card's owner calls this with its HTML (and, for a card with choices, their handler) on every render. */
export function setCard(name: string, s: string, onAction?: (action: string) => void) {
  cards[name] = s
  if (onAction) actions[name] = onAction
}
const choices = () => [...(tip?.querySelectorAll<HTMLElement>('[data-action]') ?? [])]
const inTip = (el: EventTarget | null) => !!tip && el instanceof Node && tip.contains(el)
// Keyboard focus on the trigger or inside the card keeps it open.
const focusHolds = () => !!cardEl && (document.activeElement === cardEl || inTip(document.activeElement))
function runAction(el: HTMLElement) {
  const name = cardEl?.dataset.card
  if (name && el.dataset.action) actions[name]?.(el.dataset.action)
}

function hideTip() { clearTimeout(cardTimer); cardTimer = 0; cardOn = false; if (tip && !tip.hidden) { tip.removeAttribute('data-instant'); tip.hidden = true; hidAt = performance.now() } }
function unhide() { if (!tip || !tip.hidden) return; tip.toggleAttribute('data-instant', performance.now() - hidAt < INSTANT_AFTER_MS); tip.hidden = false }
const tipTarget = (el: Element | null) => el?.closest?.<HTMLElement>('[data-tip]') ?? null
function showTip(el: Element | null) {
  if (!tip) return
  const t = tipTarget(el)
  if (!t) return hideTip()
  clearTimeout(cardTimer); cardTimer = 0; cardOn = false
  const text = t.dataset.tip!
  tip.className = (text + (t.dataset.sub ?? '')).length > LONG_TIP_CHARS ? 'long' : ''
  tip.style.maxHeight = ''
  setHTML(esc(text) + (t.dataset.sub ? `<span>${esc(t.dataset.sub)}</span>` : ''))
  unhide()
  tip.style.left = tip.style.top = '0px' // measure at its natural size
  const w = tip.offsetWidth, h = tip.offsetHeight
  const a = t.getBoundingClientRect()
  tip.style.left = Math.max(EDGE, Math.min(innerWidth - w - EDGE, mouse.x - w / 2)) + 'px'
  tip.style.top = (a.top - h - GAP < 4 ? a.bottom + GAP : a.top - h - GAP) + 'px'
}
// A card opens under its trigger and stays while the pointer is on the trigger or the card, so it can be scrolled.
// The cost card lines up with its stat box's left edge; a trigger with data-card-align="end" lines up its right edge.
function drawCard() {
  const s = cardEl
  if (!tip || !s || !s.isConnected) return hideTip()
  const name = s.dataset.card!
  tip.className = 'card ' + name
  // Redrawing replaces the card's HTML: keep keyboard focus on the same choice.
  const focused = inTip(document.activeElement) ? (document.activeElement as HTMLElement).dataset.action : undefined
  redrawing = true // removing the focused choice fires focusout: not a reason to close
  setHTML(cards[name] ?? '')
  if (focused) tip.querySelector<HTMLElement>(`[data-action="${CSS.escape(focused)}"]`)?.focus()
  redrawing = false
  unhide()
  const r = (s.closest('.stat') ?? s).getBoundingClientRect(), top = r.bottom + GAP
  tip.style.maxHeight = Math.max(CARD_MIN_HEIGHT, innerHeight - top - EDGE) + 'px'
  const left = s.dataset.cardAlign === 'end' ? r.right - tip.offsetWidth : r.left + 12
  tip.style.left = Math.max(EDGE, Math.min(innerWidth - tip.offsetWidth - EDGE, left)) + 'px'
  tip.style.top = top + 'px'
}
function showCard(trigger: HTMLElement | null) { clearTimeout(cardTimer); cardTimer = 0; cardOn = true; if (trigger) cardEl = trigger; drawCard() }
function hover(el: Element | null) {
  if (!el?.closest) return
  const t = tipTarget(el)
  const trigger = cardTrigger(el)
  if (!t && (trigger || (cardOn && el.closest('#tip')))) return showCard(trigger)
  if (cardOn) {
    if (focusHolds()) return // opened from the keyboard: stays until focus moves on
    if (!t) { cardTimer ||= window.setTimeout(hideTip, CARD_LINGER_MS); return }
  }
  showTip(el)
}

/** Called after every app render: keep the open tooltip in step with the new content. */
export function refreshTooltip() {
  if (!tip) return
  if (cardOn) drawCard()
  else if (!tip.hidden) showTip(document.elementFromPoint(mouse.x, mouse.y))
}

export function Tooltip() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    tip = ref.current
    const on = <K extends keyof DocumentEventMap>(t: K, f: (e: DocumentEventMap[K]) => void, o?: boolean | AddEventListenerOptions) => { document.addEventListener(t, f, o); return () => document.removeEventListener(t, f, o) }
    const offs = [
      on('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; hover(e.target as Element) }),
      on('mouseleave', () => { if (!cardOn || !focusHolds()) hideTip() }),
      on('focusin', e => { const t = e.target as HTMLElement; if (t.dataset?.card) showCard(t) }),
      on('focusout', e => {
        const next = e.relatedTarget
        if (!redrawing && cardOn && (e.target === cardEl || inTip(e.target)) && next !== cardEl && !inTip(next)) hideTip()
      }),
      on('click', e => {
        const el = e.target as Element
        const choice = inTip(el) ? el.closest?.<HTMLElement>('[data-action]') : null
        if (choice) return runAction(choice)
        const trigger = cardTrigger(el)
        if (trigger) return showCard(trigger) // tap on a touch screen
        if (cardOn && !inTip(el)) hideTip()
      }),
      on('keydown', e => {
        const target = e.target as HTMLElement
        if (e.key === 'Escape' && tip && !tip.hidden) {
          if (inTip(target)) cardEl?.focus()
          return hideTip()
        }
        if (!cardOn) return
        const list = choices()
        if (inTip(target) && target.dataset.action && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); return runAction(target) }
        if (e.key === 'Tab' && list.length) {
          const i = list.indexOf(target)
          if (target === cardEl && !e.shiftKey) { e.preventDefault(); return list[0].focus() }
          if (i === 0 && e.shiftKey) { e.preventDefault(); return cardEl?.focus() }
          if (i >= 0 && i < list.length - 1 && !e.shiftKey) { e.preventDefault(); return list[i + 1].focus() }
          if (i > 0 && e.shiftKey) { e.preventDefault(); return list[i - 1].focus() }
          // Past the last choice: back to the trigger, and the browser's Tab carries on from there.
          if (i === list.length - 1) { hideTip(); cardEl?.focus() }
          return
        }
        if (target !== cardEl || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return
        e.preventDefault()
        tip!.scrollTop += e.key === 'ArrowDown' ? CARD_SCROLL_STEP : -CARD_SCROLL_STEP
      }),
    ]
    const scroll = () => { cardOn && focusHolds() ? drawCard() : hideTip() }
    addEventListener('scroll', scroll, { passive: true })
    return () => { offs.forEach(f => f()); removeEventListener('scroll', scroll); tip = null }
  }, [])
  return <div id="tip" ref={ref} hidden />
}
