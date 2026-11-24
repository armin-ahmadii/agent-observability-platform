// The page's state: what the server sent (polled every 1.5s) plus what you opened, folded and chose.
// One mutable store; components re-render through useDeck() on every change.
import { useSyncExternalStore } from 'react'
import { api } from './api'
import { readJSON, writeJSON, readSession, writeSession } from './storage'
import { localId } from '../lib/ids'
import { WINS, type Chat, type CodexLimits, type CostMath, type DoneEntry, type Grade, type Limit, type McpRow, type Memory, type Run, type Session, type Snap, type Win } from '../lib/types'

export type Prefs = { stats: boolean; agents: boolean; tasks: boolean; chats: boolean; mcp: boolean; memory: boolean }
export const PREF_LABELS: [keyof Prefs, string][] = [
  ['stats', 'Cost & tokens'], ['agents', 'Agents'], ['tasks', 'Tasks'], ['chats', 'Previous orchestrators'], ['mcp', 'MCP servers'], ['memory', 'Project memory'],
]
const defaultPrefs: Prefs = { stats: true, agents: true, tasks: true, chats: true, mcp: true, memory: true }

// Browser storage keys. Session storage is per tab; prefs are remembered everywhere.
const KEY = {
  open: 'deck-open', detail: 'deck-detail', hist: 'deck-hist', asks: 'deck-asks', win: 'deck-win',
  memOpen: 'deck-mem-open', memMore: 'deck-mem-more', prefs: 'deck-show',
}

const POLL_MS = 1500
const HIDDEN_POLL_MS = 15_000 // while the page isn't visible (a hidden tab or a collapsed side panel)
const SIDE_DATA_MS = 10_000 // math, history, MCP and memory refresh at most this often
const LONG_HISTORY_MS = 60_000 // All sessions' 7d/30d Earlier agents (megabytes): at most this often
// A session's data is fetched again only when its file changed (its updatedAt in /api/sessions), or after this long
// (the server also corrects it from other sources: T3's run records, resolved agents, usage totals).
const UNCHANGED_REFRESH_MS = 5000
const TITLE_WAIT_MS = 1500 // rows wait this long for short titles on first load, then show full ones
const HIDE_SETTLE_MS = 4000 // a hidden session stays out this long after the server answered, until its list agrees

class Deck {
  // ----- from the server -----
  sessions: Session[] = []
  limits: Limit[] = []
  limitsAt: number | null = null // when Claude's limits were last reported
  codexLimits: CodexLimits | null = null
  snap: Snap | null = null
  lastSnap: Snap | null = null // the last non-null snap, drawn while the body fades out
  childSnaps = new Map<string, Snap>() // session id → snapshot, for delegated T3 tasks
  math: CostMath | null = null
  mathAt = 0
  mcpHist: { id: string; rows: McpRow[] } | null = null
  memory: Memory | null = null
  agentHist: { id: string; rows: Run[] } | null = null
  titles: Record<string, string> | null = null
  grades: Record<string, Grade> | null = null
  done: Record<string, DoneEntry> | null = null // finished agents' completed items, by agent id
  loadedOnce = false
  firstSnapAt = 0

  // ----- yours -----
  chosen: string | null = location.hash.slice(1) || null
  viewChild: string | null = null // a helper session opened with "View details" (kept in memory, never in the address)
  loadingFor: string | null = 'first' // the session being switched to, while its data loads
  openState: Record<string, boolean> = readJSON('session', KEY.open, {})
  detailState: Record<string, boolean> = readJSON('session', KEY.detail, {})
  briefOpen = new Set<string>()
  saving = new Map<string, number>() // run id → time pressed
  toggling = new Map<string, { on: boolean; at: number }>() // helper name → wanted state
  histOpen = readSession(KEY.hist) === '1'
  asksOpen = readSession(KEY.asks) === '1' // Tasks: the requests past the first few
  revealing: string | null = null // an agent row to scroll to and open (from Tasks)
  memOpen = new Set<string>(readJSON<string[]>('session', KEY.memOpen, []))
  memMore: Record<string, boolean> = readJSON('session', KEY.memMore, {})
  menuOpen = false
  settingsOpen = false
  prefs: Prefs = { ...defaultPrefs, ...readJSON<Partial<Prefs>>('local', KEY.prefs, {}) }
  titlesAsked = new Set<string>()
  gradesAsked = new Set<string>()
  doneAsked = new Set<string>()
  // All sessions: the timeframe (remembered per tab), the chats it shows as working (sent for "Active"), and its chat list.
  win: Win = (WINS as readonly string[]).includes(readSession(KEY.win) ?? '') ? readSession(KEY.win) as Win : '24h'
  activeIds: string[] = []
  chats: { win: Win; rows: Chat[] } | null = null
  hiding = new Set<string>() // sessions just hidden here, kept out until the server's list agrees
  resolving = new Set<string>() // "<sessionId>:<runId>" marked resolved here; shown resolved at once, before the server agrees

  // ----- subscription -----
  private version = 0
  private subs = new Set<() => void>()
  subscribe = (f: () => void) => { this.subs.add(f); return () => { this.subs.delete(f) } }
  getVersion = () => this.version
  render = () => { this.version++; for (const f of this.subs) f() }

  // ----- reading -----
  // Finished agents and MCP history of the shown session (empty while another session's are still loaded).
  get agentRows(): Run[] { return this.agentHist?.id === this.snap?.sessionId ? this.agentHist!.rows : [] }
  get mcpRows(): McpRow[] { return this.mcpHist?.id === this.snap?.sessionId ? this.mcpHist!.rows : [] }
  // The session a T3 delegated task runs in: the newest other session titled like the task.
  taskSession(label?: string) {
    return this.sessions.filter(x => (x.title === label || x.rawTitle === label) && x.id !== this.snap?.sessionId).sort((a, b) => b.updatedAt - a.updatedAt)[0]
  }
  // A T3 helper's own main run: from All sessions' helperMains when it has it, else from the helper's fetched session.
  helperMain(sessionId: string): Run | undefined {
    return this.snap?.helperMains?.[sessionId]?.main ?? this.childSnaps.get(sessionId)?.runs?.find(x => x.id === 'main')
  }
  // Load a session's snapshot into childSnaps once (Previous orchestrators open with it).
  ensureChildSnap(id: string) {
    if (this.childSnaps.has(id)) return
    this.childSnaps.set(id, { sessionId: id })
    api.session(id).then(d => { if (d) { this.childSnaps.set(id, d); this.render() } }).catch(() => {})
  }

  // ----- loading -----
  // What was last fetched for each key ("snap:<id><window>", "child:<id>"): the session's updatedAt then, and when.
  private fetched = new Map<string, { stamp: number; at: number }>()
  private isFresh(key: string, stamp: number) {
    const f = this.fetched.get(key)
    return !!f && f.stamp === stamp && Date.now() - f.at < UNCHANGED_REFRESH_MS
  }
  private noteFetched(key: string, stamp: number) { this.fetched.set(key, { stamp, at: Date.now() }) }
  private historyAt = new Map<string, number>() // history key → when fetched
  // Polls can overlap (the 1.5s loop, a session switch, a hash change): only the newest one's answers are used.
  private pollSeq = 0
  async poll() {
    const seq = ++this.pollSeq
    const stale = () => seq !== this.pollSeq
    try {
      const list = await api.sessions()
      if (stale()) return
      const every: (Session & { hidden?: boolean })[] = Array.isArray(list) ? list : list?.sessions ?? []
      this.limits = list?.limits ?? []
      this.limitsAt = list?.limitsAt ?? null
      this.codexLimits = list?.codexLimits ?? null
      // Hidden sessions leave the menu and the lists, but still count in the All row's spend and weekly share.
      const sessions: Session[] = every.filter(s => !s.hidden && !this.hiding.has(s.id))
      if (this.chosen && this.chosen !== 'all' && every.some(s => s.id === this.chosen) && !sessions.some(s => s.id === this.chosen)) { this.chosen = 'all'; history.replaceState(null, '', '#all') }
      sessions.unshift(allSessionsRow(every))
      this.sessions = sessions
      // A helper's own session opens only from "View details": a reload never lands inside one.
      const asked = this.chosen && sessions.find(s => s.id === this.chosen)
      if (asked && asked.parentId) { this.chosen = asked.parentId; history.replaceState(null, '', '#' + this.chosen) }
      const pick = (this.viewChild && sessions.find(s => s.id === this.viewChild)) ||
        (this.chosen && sessions.find(s => s.id === this.chosen)) || [...sessions].filter(s => !s.parentId).sort((a, b) => b.updatedAt - a.updatedAt)[0]
      const w = pick?.id === 'all' ? this.winQuery() : '', askedWin = this.win
      // Unchanged since the last fetch: keep the snap we have. All sessions changes when any session does.
      const snapKey = 'snap:' + (pick?.id ?? '') + w
      const stamp = pick?.id === 'all' ? Math.max(0, ...every.map(s => s.updatedAt || 0)) : pick?.updatedAt ?? 0
      const reuse = !!pick && this.snap?.sessionId === pick.id && this.isFresh(snapKey, stamp)
      const fresh = reuse ? this.snap : pick ? await api.session(pick.id, w) : null
      if (pick && !reuse) this.noteFetched(snapKey, stamp)
      // A newer poll, or a timeframe switch while this was loading: drop this answer.
      if (stale() || (pick?.id === 'all' && askedWin !== this.win)) return
      this.snap = fresh
      if (fresh) this.lastSnap = fresh
      this.settleResolving()
      if (this.snap && !this.firstSnapAt) { this.firstSnapAt = Date.now(); setTimeout(this.render, TITLE_WAIT_MS + 50) }
      this.loadedOnce = true
      if (this.loadingFor === 'first') this.loadingFor = null
      this.loadTaskSessions()
      if (pick && (this.math?.id !== pick.id || Date.now() - this.mathAt > SIDE_DATA_MS)) this.loadSideData(pick.id, w, askedWin)
      this.render()
    } catch {}
  }
  // Delegated T3 tasks: keep their own sessions' snapshots (live ones whenever their file changed, finished ones once).
  private loadTaskSessions() {
    const asked = new Set<string>()
    for (const r of this.snap?.runs ?? []) {
      if (r.type !== 'delegated') continue
      const s = this.taskSession(r.label)
      if (!s || asked.has(s.id) || this.snap?.helperMains?.[s.id]) continue
      const key = 'child:' + s.id
      if (this.childSnaps.has(s.id) && (!s.isLive || this.isFresh(key, s.updatedAt))) continue
      asked.add(s.id)
      this.noteFetched(key, s.updatedAt)
      api.session(s.id).then(d => { if (d) this.childSnaps.set(s.id, d) }).catch(() => {})
    }
  }
  // Everything besides the snapshot. All sessions answers for the timeframe asked; a late answer for an old one is dropped.
  private loadSideData(id: string, w: string, askedWin: Win) {
    this.mathAt = Date.now()
    const current = () => id !== 'all' || askedWin === this.win
    const isMap = (d: unknown) => !!d && typeof d === 'object' && !Array.isArray(d)
    api.mcpHistory(id).then(rows => { this.mcpHist = { id, rows } }).catch(() => {})
    api.memory(id).then(d => { this.memory = { id, ...d } }).catch(() => {})
    // Long timeframes' history is large and changes slowly (agents finishing now come from the live data anyway).
    const histKey = id + w, long = id === 'all' && (askedWin === '7d' || askedWin === '30d')
    if (!long || this.agentHist?.id !== id || Date.now() - (this.historyAt.get(histKey) ?? 0) > LONG_HISTORY_MS) {
      this.historyAt.set(histKey, Date.now())
      api.history(id, w).then(rows => { if (current()) this.agentHist = { id, rows } }).catch(() => {})
    }
    if (id === 'all') api.chats(w).then(rows => { if (Array.isArray(rows) && askedWin === this.win) this.chats = { win: askedWin, rows } }).catch(() => {})
    // Titles render as soon as they come, so the first paint already has short titles.
    api.titles().then(t => { if (isMap(t)) { const first = !this.titles; this.titles = t; if (first) this.render() } }).catch(() => {})
    // Without /api/done (older mod versions), finished agents' lists simply don't show.
    api.done().then(d => { if (isMap(d)) this.done = d }).catch(() => {})
    api.grades().then(g => { if (isMap(g)) this.grades = g }).catch(() => {})
    api.math(id, w).then(m => { if (current()) this.math = m && { ...m, id } }).catch(() => {})
  }
  start() {
    let timer = 0
    const loop = async () => {
      clearTimeout(timer)
      await this.poll()
      clearTimeout(timer)
      timer = window.setTimeout(loop, document.hidden ? HIDDEN_POLL_MS : POLL_MS)
    }
    loop()
    // Shown again: refresh now and go back to the fast pace.
    document.addEventListener('visibilitychange', () => { if (!document.hidden) loop() })
    addEventListener('hashchange', () => { this.chosen = location.hash.slice(1) || null; this.poll() })
  }

  // Waiting for the session we switched to (or the first load, or first short titles): show the skeleton.
  get waiting() {
    const lf = this.loadingFor
    const w = lf && (lf === 'first' ? !this.sessions.length && !this.loadedOnce : this.snap?.sessionId !== lf)
    if (!w) this.loadingFor = null
    if (w) return true
    return !!this.snap && !this.titles && Date.now() - this.firstSnapAt < TITLE_WAIT_MS
  }

  // ----- actions -----
  post(body: Record<string, unknown>) { if (this.snap) api.action(this.snap.sessionId, body) }
  openKey = (id: string) => (this.snap?.sessionId ?? '') + ':' + id
  isOpen = (id: string) => this.openState[this.openKey(id)] ?? (id === 'main' || String(id).startsWith('project:'))
  detailOpen = (id: string) => !!this.detailState[this.openKey(id)]
  setMenu(open: boolean) { if (this.menuOpen !== open) { this.menuOpen = open; this.render() } }
  setSettings(open: boolean) { if (this.settingsOpen !== open) { this.settingsOpen = open; this.render() } }
  // Switching shows the skeleton at once (and the new name), instead of the old session lingering.
  startSwitch(id: string | null | undefined) {
    this.loadingFor = id ?? null
    scrollTo(0, 0)
    this.render()
  }
  choose(id: string) {
    this.chosen = id
    this.viewChild = null
    if (id !== this.snap?.sessionId) this.startSwitch(id)
    history.replaceState(null, '', '#' + id)
    this.menuOpen = false
    this.render()
    this.poll()
  }
  // Hide a session from the dashboard (its files are kept). Viewing it? Go to All sessions.
  hide(id: string) {
    this.hiding.add(id)
    this.sessions = this.sessions.filter(s => s.id !== id)
    api.hide(id).finally(() => setTimeout(() => this.hiding.delete(id), HIDE_SETTLE_MS))
    if (this.chosen === id || this.snap?.sessionId === id) this.choose('all')
    else this.render()
  }
  back() {
    this.viewChild = null
    this.startSwitch(this.chosen ?? this.sessions.find(x => x.id === this.snap?.sessionId)?.parentId)
    this.poll()
  }
  view(sessionId: string) { this.viewChild = sessionId; this.startSwitch(sessionId); this.poll() }
  toggleFold(id: string, to?: boolean) {
    this.openState[this.openKey(id)] = to ?? !this.isOpen(id)
    writeJSON('session', KEY.open, this.openState)
    this.render()
  }
  toggleDetail(id: string) {
    this.detailState[this.openKey(id)] = !this.detailOpen(id)
    writeJSON('session', KEY.detail, this.detailState)
    this.render()
  }
  toggleBrief(id: string) { this.briefOpen.has(id) ? this.briefOpen.delete(id) : this.briefOpen.add(id); this.render() }
  save(id: string) { this.saving.set(id, Date.now()); this.post({ kind: 'save', id }); this.render() }
  // Clear an agent's needs-attention marker (dashboard only). It then leaves Agents like any finished agent.
  // Shown resolved at once; put back if the server didn't store it.
  resolve(sessionId: string, runId: string) {
    const key = sessionId + ':' + runId
    this.resolving.add(key)
    this.render()
    api.resolve(sessionId, runId).then(ok => { if (!ok) { this.resolving.delete(key); this.render() } })
  }
  // Resolved runs the server now sends without attention no longer need the local override.
  private settleResolving() {
    if (!this.resolving.size || !this.snap) return
    for (const r of this.snap.runs ?? []) if (!r.attention) this.resolving.delete((r.sessionOf ?? this.snap.sessionId) + ':' + localId(r))
  }
  toggleHelper(name: string, wasOn: boolean) { this.toggling.set(name, { on: !wasOn, at: Date.now() }); this.post({ kind: 'toggle', name }); this.render() }
  winQuery() { return '&win=' + this.win + (this.win === 'active' ? '&s=' + this.activeIds.join(',') : '') }
  // A new timeframe: refetch its totals, math, chats and earlier agents now.
  setWin(w: Win) {
    if (w === this.win) return
    this.win = w
    writeSession(KEY.win, w)
    this.mathAt = 0
    this.render()
    this.poll()
  }
  toggleAsks() { this.asksOpen = !this.asksOpen; writeSession(KEY.asks, this.asksOpen ? '1' : '0'); this.render() }
  // Open an agent's breakdown and scroll to its row; Agents finds the row (unfolding parents or Earlier agents) after paint.
  reveal(id: string) {
    this.detailState[this.openKey(id)] = true
    writeJSON('session', KEY.detail, this.detailState)
    this.revealing = id
    this.render()
  }
  toggleHist() { this.histOpen = !this.histOpen; writeSession(KEY.hist, this.histOpen ? '1' : '0'); this.render() }
  private memSave() { writeJSON('session', KEY.memOpen, [...this.memOpen]); writeJSON('session', KEY.memMore, this.memMore) }
  toggleMem(id: string) { this.memOpen.has(id) ? this.memOpen.delete(id) : this.memOpen.add(id); this.memSave(); this.render() }
  toggleMemMore(which: string) { this.memMore[which] = !this.memMore[which]; this.memSave(); this.render() }
  setPref(k: keyof Prefs, on: boolean) { this.prefs = { ...this.prefs, [k]: on }; writeJSON('local', KEY.prefs, this.prefs); this.render() }
  // Thumbs up/down: one vote each; the same thumb again removes it. Memory reloads right after.
  vote(d: { vsid: string; id: string; label: string; model?: string; kind: string; score: number }) {
    const sid = this.snap?.sessionId
    api.vote({ sessionId: d.vsid, id: d.id, label: d.label, model: d.model || undefined, kind: d.kind, score: d.score })
      .then(() => sid ? api.memory(sid) : null).then(m => { if (m && sid) { this.memory = { id: sid, ...m }; this.render() } }).catch(() => {})
  }
}

// "All sessions": every open session at once, listed first in the menu.
function allSessionsRow(every: Session[]): Session {
  const open = every.filter(s => s.isLive && !s.parentId)
  const sum = (k: keyof Session) => open.reduce((n, s) => n + (Number(s[k]) || 0), 0)
  return {
    id: 'all', title: 'All sessions', isLive: open.length > 0, working: sum('working'), totalUsd: sum('totalUsd'),
    weekPct: open.some(s => s.weekPct != null) ? open.reduce((n, s) => n + (s.weekPctAll ?? s.weekPct ?? 0), 0) : null,
    weekTokens: sum('weekTokens'), startedAt: Infinity, updatedAt: 0,
  }
}

export const deck = new Deck()
export function useDeck() {
  useSyncExternalStore(deck.subscribe, deck.getVersion)
  return deck
}
