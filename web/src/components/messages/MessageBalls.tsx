// Your prompts as balls in the agents list: one blue ball per prompt you sent that is still being worked on (never
// one per step: an agent's own subtasks belong to the prompt), stacked like avatars in the row of whoever holds it,
// three at most then "+n". A new message first shows as your chat bubble, fixed at the bottom-right corner of the
// window whatever is scrolled or open, and stays long enough to read (READ_MS: the one deliberate hold). Then it
// shrinks into its ball in the main agent's row (in All sessions: that chat's row), or wherever it has been routed by
// then. The moment a prompt is routed, its ball leaves that stack and a traveller (a dot with a short trail) rides the
// tree's own line: out of the row's logo, down the trunk, round the elbow into the helper's row, where the ball joins
// that stack. Several routes: one traveller each down the same trunk, peeling off at its own row. A ball goes the
// moment the prompt is answered, or for a routed one when that helper finishes it. A row flashes blue briefly when a
// ball arrives. Hover or focus a ball to read its prompt.
// The balls are a picture of the data: each refresh says where every ball should be, and motion only bridges the
// change. A route that lands while the bubble is in the air takes the ball from where the bubble is.
// No React renders. Bubble and balls: transform/opacity on springs (sampled into CSS linear(), off the main thread).
// The traveller follows a path (offset-distance), one small dot for under a second.
// Reduced motion: no bubble, no traveller; balls appear and go in place, rows still flash.
// Switched off in the settings menu ("Message animation"): none of it shows.
import { useEffect } from 'react'
import { cleanMsg } from '../../lib/format'
import { sentMessages, targetsOf, type Sent } from '../../lib/routes'
import type { Model } from '../../lib/tree'
import type { Run } from '../../lib/types'

// A spring as a WAAPI easing. `response` is how fast it gets there (seconds), `damping` 1 = no overshoot, below 1 bounces.
function spring(response: number, damping: number) {
  const w = 2 * Math.PI / response
  const at = (t: number) => {
    if (damping >= 1) return 1 - (1 + w * t) * Math.exp(-w * t)
    const wd = w * Math.sqrt(1 - damping * damping)
    return 1 - Math.exp(-damping * w * t) * (Math.cos(wd * t) + (damping * w / wd) * Math.sin(wd * t))
  }
  let dur = response
  while (dur < 3 && (Math.abs(1 - at(dur)) > 0.001 || Math.abs(1 - at(dur + 0.03)) > 0.001)) dur += 0.01
  const N = 48
  const pts = Array.from({ length: N + 1 }, (_, i) => (i === N ? 1 : at(dur * i / N)).toFixed(4))
  const easing = `linear(${pts.join(', ')})`
  return { duration: dur * 1000, easing: CSS.supports('transition-timing-function', easing) ? easing : 'cubic-bezier(0.23, 1, 0.32, 1)' }
}
const POP = spring(0.34, 0.72) // a bubble or a ball arriving: a little bounce
const MOVE_X = spring(0.4, 1) // the bubble's flight to the main row: no overshoot
const MOVE_Y = spring(0.32, 1)
const ROLL = spring(0.34, 0.86) // a ball rolling to a helper's row: short, settles with a hint of weight
const READ_MS = 1200 // the bubble stays this long so two lines can be read
const ARRIVE = 0.45 // of a spring's length: by then it is there to the eye (the tail is long and slow)
const END_SCALE = 0.12 // the bubble shrinks to about a ball
const SPLIT_MS = 70 // several routes at once: a little apart, so they read as separate travellers on the trunk
const MAX_BALLS = 3 // a stack shows this many (the newest), then "+n"
const TRAVEL_BASE_MS = 260, TRAVEL_PER_PX = 1.5, TRAVEL_MAX_MS = 720 // the traveller: longer lines take a little longer
const TRAVEL_EASE = 'cubic-bezier(0.77, 0, 0.175, 1)' // on-screen movement along a line: eases out of the logo and into the row
const ELBOW_R = 6 // the corner where a traveller leaves the trunk for a row
const TRAIL = [14, 28] // ms: two fainter dots follow the traveller, so its direction reads
const GONE_MS = 140
const FRESH_MS = 30000 // only a message this new flies in from the corner; older ones are simply there
const FLASH_IN_MS = 110
const FLASH_SETTLE_MS = 450
const FLASH_MS = 1400
const OUT = 'cubic-bezier(0.23, 1, 0.32, 1)'
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches
/** Runs `then` when the animation finishes by itself (not when it is cancelled or its element removed). */
const after = (a: Animation, then: () => void) => { a.finished.then(then, () => {}) }

const balls = new Map<string, HTMLElement>() // message key + row id → its ball
type Bubble = { el: HTMLElement; flying: boolean; timer: number }
const bubbles = new Map<string, Bubble>() // message key → its bubble, being read in the corner or in the air
const placed = new Map<string, string[]>() // message key → the rows its balls were in after the last refresh
let primedFor = ''

const keyOf = (s: Sent) => s.sessionId + ':' + s.ask.at
const rowEl = (id: string) => document.querySelector<HTMLElement>(`#agents [data-run="${CSS.escape(id)}"]`)
const centre = (el: Element) => { const r = el.getBoundingClientRect(); return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null }

// The row flashes blue from its left edge when a ball arrives. A second arrival starts it again.
function flash(row: HTMLElement | null) {
  if (!row?.isConnected) return
  row.querySelector(':scope > .mf-flash')?.remove()
  const t = document.createElement('span')
  t.className = 'mf-flash'
  t.setAttribute('aria-hidden', 'true')
  row.prepend(t)
  const done = () => t.remove()
  t.animate([
    { opacity: 0, easing: OUT },
    { opacity: 1, offset: FLASH_IN_MS / FLASH_MS, easing: OUT },
    { opacity: 0.4, offset: FLASH_SETTLE_MS / FLASH_MS, easing: 'cubic-bezier(0.45, 0, 0.55, 1)' },
    { opacity: 0 },
  ], { duration: FLASH_MS, fill: 'both' }).finished.then(done, done)
}

function corner() {
  let c = document.getElementById('mf-corner')
  if (!c) { c = document.createElement('div'); c.id = 'mf-corner'; c.setAttribute('aria-hidden', 'true'); document.body.append(c) }
  return c
}

function ballEl(text: string) {
  const b = document.createElement('span')
  b.className = 'ball'
  b.tabIndex = 0
  b.setAttribute('role', 'img')
  b.setAttribute('aria-label', 'Your message: ' + text)
  b.dataset.tip = text
  return b
}

// A new message: its bubble pops in at the corner and stays to be read; then launch() sends it on.
// (.mf moves across, .mf-y moves up and shrinks toward its right edge, .mf-bubble pops in.)
function showBubble(key: string, text: string) {
  const el = document.createElement('div'); el.className = 'mf'
  const y = document.createElement('div'); y.className = 'mf-y'
  const b = document.createElement('div'); b.className = 'mf-bubble'
  const span = document.createElement('span'); span.textContent = text
  b.append(span); y.append(b); el.append(y)
  corner().append(el)
  b.animate([{ opacity: 0, transform: 'translateY(10px) scale(0.6)' }, { opacity: 1, transform: 'none' }], POP)
  bubbles.set(key, { el, flying: false, timer: window.setTimeout(() => launch(key), READ_MS) })
}

// Reading time is over: the bubble shrinks into each ball waiting for it (one copy per ball). With no ball left
// (the message was answered meanwhile) it goes into the main row; with no row, it fades where it is.
function launch(key: string) {
  const bub = bubbles.get(key)
  if (!bub) return
  bub.flying = true
  const waiting = [...balls].filter(([k, b]) => k.startsWith(key + '|') && b.isConnected).map(([, b]) => b)
  const main = rowEl(key.replace(/:\d+$/, ':main')) ?? rowEl('main')
  const targets: { at: { x: number; y: number }; ball?: HTMLElement; row: HTMLElement | null }[] = waiting.length
    ? waiting.map(b => ({ at: centre(b)!, ball: b, row: b.closest<HTMLElement>('[data-run]') })).filter(t => t.at)
    : main ? [{ at: centre(main.querySelector(':scope > .balls') ?? main)!, row: main }] : []
  const from = bub.el.getBoundingClientRect()
  if (!targets.length) {
    const gone = () => { bub.el.remove(); if (bubbles.get(key) === bub) bubbles.delete(key) }
    bub.el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: GONE_MS, easing: OUT, fill: 'both' }).finished.then(gone, gone)
    return
  }
  const total = Math.max(MOVE_X.duration, MOVE_Y.duration)
  targets.forEach((t, i) => {
    const el = i === 0 ? bub.el : bub.el.cloneNode(true) as HTMLElement
    // Out of the corner's stack and pinned where it is, so nothing else moves it mid-flight.
    Object.assign(el.style, { position: 'fixed', left: from.left + 'px', top: from.top + 'px', width: from.width + 'px', zIndex: '40' })
    document.body.append(el)
    const delay = i * SPLIT_MS, lands = delay + total * ARRIVE
    const dx = t.at.x - from.right, dy = t.at.y - (from.top + from.height / 2)
    el.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${dx.toFixed(1)}px)` }], { ...MOVE_X, delay, fill: 'both' })
    el.firstElementChild!.animate([{ transform: 'translateY(0) scale(1)' }, { transform: `translateY(${dy.toFixed(1)}px) scale(${END_SCALE})` }], { ...MOVE_Y, delay, fill: 'both' })
    const gone = () => { el.remove(); if (i === 0 && bubbles.get(key) === bub) bubbles.delete(key) }
    el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: total * 0.2, delay: lands - total * 0.1, easing: OUT, fill: 'both' }).finished.then(gone, gone)
    // The ball shows as the bubble reaches it, and the row flashes.
    if (t.ball) {
      t.ball.animate([{ opacity: 0, transform: 'scale(0.3)' }, { opacity: 1, transform: 'none' }], { ...POP, delay: lands - total * 0.06, fill: 'backwards' })
      t.ball.classList.remove('pending')
    }
    after(el.animate([], { duration: lands }), () => flash(t.ball?.closest<HTMLElement>('[data-run]') ?? t.row))
  })
}

// "+n" beside a stack that holds more than it shows.
function count(slot: Element | null | undefined) {
  if (!(slot instanceof HTMLElement)) return
  const n = slot.querySelectorAll(':scope > .ball:not(.going)').length
  if (n > MAX_BALLS) slot.dataset.more = '+' + (n - MAX_BALLS); else delete slot.dataset.more
}

// The tree line from one row down to a row under it, in the first row's own coordinates: out of its logo, down its
// trunk, round the elbow into the next logo, and so on for each level in between. Null when `to` is not under `from`.
function linePath(from: HTMLElement, to: HTMLElement): { d: string; len: number } | null {
  const depth = (r: Element) => r.querySelectorAll(':scope > .lead > .g').length
  const rows = [...document.querySelectorAll<HTMLElement>('#agents [data-run]')]
  const chain = [to]
  for (let i = rows.indexOf(to) - 1, d = depth(to); i >= 0 && chain[0] !== from; i--) if (depth(rows[i]) < d) { chain.unshift(rows[i]); d = depth(rows[i]) }
  if (chain[0] !== from || chain.length < 2) return null
  const o = from.getBoundingClientRect()
  const pts = chain.map(r => centre(r.querySelector(':scope > .lead .logo') ?? r))
  if (pts.some(p => !p)) return null
  const P = pts.map(p => ({ x: p!.x - o.left, y: p!.y - o.top }))
  let d = `M${P[0].x.toFixed(1)} ${P[0].y.toFixed(1)}`, len = 0
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1], b = P[i], r = Math.min(ELBOW_R, Math.abs(b.x - a.x), Math.abs(b.y - a.y))
    d += `V${(b.y - r).toFixed(1)}Q${a.x.toFixed(1)} ${b.y.toFixed(1)} ${(a.x + r).toFixed(1)} ${b.y.toFixed(1)}H${b.x.toFixed(1)}`
    len += Math.abs(b.y - a.y) + Math.abs(b.x - a.x)
  }
  return { d, len }
}

// A prompt routed to a helper: a traveller rides the tree line from the row that held it to the helper's row, where
// the ball (unseen until then) joins the stack and the row flashes.
function travel(from: HTMLElement, path: { d: string; len: number }, ball: HTMLElement, delay: number) {
  const duration = Math.min(TRAVEL_MAX_MS, TRAVEL_BASE_MS + path.len * TRAVEL_PER_PX)
  ball.classList.add('pending')
  const arrive = () => {
    if (!ball.classList.contains('pending')) return
    ball.classList.remove('pending')
    if (ball.isConnected) { popIn(ball); flash(ball.closest<HTMLElement>('[data-run]')) }
  }
  const dots = [0, ...TRAIL].map((lag, i) => {
    const t = document.createElement('span')
    t.className = 'mf-trav' + (i ? ' trail' : '')
    t.setAttribute('aria-hidden', 'true')
    t.style.offsetPath = `path('${path.d}')`
    from.append(t)
    const a = t.animate([{ offsetDistance: '0%' }, { offsetDistance: '100%' }], { duration, delay: delay + lag, easing: TRAVEL_EASE, fill: 'both' })
    // It comes out of the logo and sinks into the next one.
    t.animate([{ opacity: 0 }, { opacity: i ? 0.4 / i : 1, offset: 0.12 }, { opacity: i ? 0.4 / i : 1, offset: 0.86 }, { opacity: 0 }], { duration, delay: delay + lag, fill: 'both' })
    const gone = () => t.remove()
    a.finished.then(gone, gone)
    return a
  })
  // The ball shows as the traveller sinks in (also if the row it rode from went away meanwhile).
  after(ball.animate([], { duration: delay + duration * 0.9 }), arrive)
  dots[0].finished.then(arrive, arrive)
}

// A ball that has just been put in its new row starts from where the message was and rolls home.
function rollIn(ball: HTMLElement, from: { x: number; y: number }, delay: number) {
  const to = centre(ball)
  if (!to) return
  ball.classList.add('moving')
  ball.animate([{ transform: `translate(${(from.x - to.x).toFixed(1)}px, ${(from.y - to.y).toFixed(1)}px)` }, { transform: 'none' }], { ...ROLL, delay, fill: 'backwards' })
    .finished.then(() => ball.classList.remove('moving'), () => {})
  ball.animate([{ opacity: 1 }, { opacity: 1, offset: ARRIVE }, { opacity: 0 }], { duration: ROLL.duration, delay, fill: 'both', pseudoElement: '::after' })
  after(ball.animate([], { duration: delay + ROLL.duration * ARRIVE }), () => flash(ball.closest<HTMLElement>('[data-run]')))
}

function popIn(ball: HTMLElement) {
  ball.animate([{ opacity: 0, transform: 'scale(0.3)' }, { opacity: 1, transform: 'none' }], POP)
}

function vanish(ball: HTMLElement) {
  const slot = ball.parentElement
  if (reduced() || !ball.isConnected) { ball.remove(); count(slot); return }
  ball.classList.add('going')
  count(slot)
  const gone = () => ball.remove()
  ball.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.3)' }], { duration: GONE_MS, easing: OUT, fill: 'both' }).finished.then(gone, gone)
}

// Where a message's balls belong right now: nowhere once it is done; the helpers still on it; else the main row.
function rowsFor(s: Sent, newer: boolean, runs: Run[], isAll: boolean): string[] {
  const mainId = isAll ? `${s.sessionId}:main` : 'main'
  const helpers = targetsOf(s, runs, isAll).filter(r => r.id !== mainId)
  if (!helpers.length) return s.ask.answeredAt || newer || !rowEl(mainId) ? [] : [mainId]
  // A helper is done with it when its own record of this ask is finished, or it has stopped.
  const busy = helpers.filter(r => r.now !== 'done' && !(r.asks ?? []).find(a => a.at >= s.ask.at)?.finishedAt)
  return [...new Set(busy.map(r => rowEl(r.id) ? r.id : mainId))].filter(id => rowEl(id))
}

function sync(m: Model) {
  const view = m.snap.sessionId, isAll = view === 'all'
  const first = primedFor !== view
  if (first) {
    primedFor = view
    for (const b of balls.values()) b.remove()
    for (const b of bubbles.values()) { clearTimeout(b.timer); b.el.remove() }
    balls.clear(); bubbles.clear(); placed.clear()
  }
  const still = reduced()
  const sent = sentMessages(m.snap) // newest first
  const want = new Map<string, string[]>()
  for (const s of [...sent].reverse()) {
    const key = keyOf(s), text = cleanMsg(s.ask.text)
    const newer = sent.some(x => x.sessionId === s.sessionId && x.ask.at > s.ask.at)
    const rows = rowsFor(s, newer, m.runs, isAll)
    const was = placed.get(key)
    want.set(key, rows)
    // A message seen for the first time, and new enough: its bubble shows in the corner.
    if (!first && !still && !was && Date.now() - s.ask.at <= FRESH_MS) showBubble(key, text)
    // Where the message is on screen now: its bubble if in the air, else its ball in a row it is leaving.
    const leaving = (was ?? []).filter(id => !rows.includes(id))
    const bubble = bubbles.get(key)
    const reading = !!bubble && !bubble.flying
    const fromBall = leaving.map(id => balls.get(key + '|' + id)).find(b => b?.isConnected)
    const fromRow = bubble?.flying ? null : fromBall?.closest<HTMLElement>('[data-run]') ?? null
    const src = bubble?.flying ? (() => { const r = bubble.el.firstElementChild!.getBoundingClientRect(); return { x: r.right - 4, y: r.top + r.height / 2 } })()
      : fromBall ? centre(fromBall) : null
    let n = 0
    for (const id of rows) {
      const k = key + '|' + id, slot = rowEl(id)?.querySelector<HTMLElement>(':scope > .balls')
      if (!slot) continue
      const old = balls.get(k)
      if (old && old.parentElement === slot) continue
      old?.remove()
      const ball = ballEl(text)
      slot.append(ball)
      balls.set(k, ball)
      count(slot)
      // A row drawn again (or a first look) just shows its balls; otherwise the ball arrives.
      if (first || old || still) continue
      // While its bubble is being read the ball waits unseen: the bubble will shrink into it.
      const row = slot.parentElement as HTMLElement
      const path = fromRow ? linePath(fromRow, row) : null
      if (reading) ball.classList.add('pending')
      else if (fromRow && path) travel(fromRow, path, ball, n++ * SPLIT_MS)
      else if (src) rollIn(ball, src, n++ * SPLIT_MS)
      else popIn(ball)
    }
    if (still && !first && rows.some(id => !(was ?? []).includes(id))) rows.filter(id => !(was ?? []).includes(id)).forEach(id => flash(rowEl(id)))
    // Balls in rows it has left shrink away (when it moved on, the traveller sets off from that row as they do).
    for (const id of leaving) {
      const k = key + '|' + id, b = balls.get(k)
      balls.delete(k)
      if (b) vanish(b)
    }
    // A route that landed mid-flight: the rolling balls took over from the bubble.
    if (bubble?.flying && src && n) { bubble.el.remove(); bubbles.delete(key) }
    placed.set(key, rows)
  }
  // Messages that dropped off the list.
  for (const [key, rows] of placed) if (!want.has(key)) {
    for (const id of rows) { const b = balls.get(key + '|' + id); balls.delete(key + '|' + id); if (b) vanish(b) }
    placed.delete(key)
  }
}

function clearAll() {
  for (const b of balls.values()) b.remove()
  for (const b of bubbles.values()) { clearTimeout(b.timer); b.el.remove() }
  document.querySelectorAll('.mf, .mf-flash, .mf-trav').forEach(e => e.remove())
  document.querySelectorAll<HTMLElement>('.balls[data-more]').forEach(e => delete e.dataset.more)
  balls.clear(); bubbles.clear(); placed.clear()
  primedFor = ''
}

export function MessageBalls({ m, on }: { m: Model; on: boolean }) {
  useEffect(() => { if (on) sync(m); else if (primedFor) clearAll() })
  return null
}
