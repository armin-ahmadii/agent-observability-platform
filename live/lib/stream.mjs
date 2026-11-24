// Live change notices: a WebSocket at /api/ws?id=<sessionId|all> tells an open page the moment a session file it
// shows changed, so it refetches at once instead of waiting for its next poll. (A WebSocket, not a long-lived HTTP
// response: those each hold one of the browser's 6 connections per site, and several tabs would use them all up.)
// One folder watcher serves every client; it runs only while at least one is connected.
import { readdirSync, statSync, watch } from 'node:fs'
import { join } from 'node:path'
import { SESSIONS_DIR } from './paths.mjs'
import { acceptWebSocket, refuseUpgrade } from './websocket.mjs'
import { SECOND } from './time.mjs'

const DEBOUNCE_MS = 30 // a write (temp file + rename) fires several events; send one message for them
const SCAN_MS = 250 // backup scan for writes fs.watch reports late
const PING_MS = 25 * SECOND // keeps an idle socket from being closed
const MAX_CLIENTS = 32

// "<id>.json" or a temp file for it ("<id>.json.tmp", "<id>.json.<n>.tmp") -> the session id.
export function sessionIdOfFile(name) {
  const m = /^([\w-]+)\.json(?:\.[\w.-]*tmp)?$/.exec(String(name ?? ''))
  return m ? m[1] : null
}

// Which changed ids a client watching `view` gets: "all" gets every change (any session can change the All
// view's rows and totals); a session view gets its own file and those of sessions linked to it (its T3 helpers,
// or the session that delegated to it). `related(id)`: the ids linked to the viewed session.
export function idsForView(view, changed, related) {
  if (view === 'all') return [...changed]
  const keep = new Set([view, ...related(view)])
  return [...changed].filter(id => keep.has(id))
}

// Watches the sessions folder; calls onChange(Set of ids) at most once per DEBOUNCE_MS. Returns a stop function.
// macOS fs.watch sometimes reports a write seconds late, so a cheap scan backs it up: every SCAN_MS it stats the
// folder's files (no reads) and reports any whose mtime or size changed. Each file version is reported once,
// whichever of the two sees it first.
// `fsWatch: false` leaves only the scan (used by tests to check it alone).
export function watchSessions(onChange, dir = SESSIONS_DIR, { fsWatch = true } = {}) {
  const seen = new Map() // id -> "mtimeMs:size" of the version last reported ("gone" once deleted)
  const versionOf = id => {
    try { const st = statSync(join(dir, `${id}.json`)); return `${st.mtimeMs}:${st.size}` } catch { return 'gone' }
  }
  const fileIds = () => { try { return readdirSync(dir).filter(n => n.endsWith('.json')).map(sessionIdOfFile).filter(Boolean) } catch { return [] } }
  for (const id of fileIds()) seen.set(id, versionOf(id))

  let pending = new Set(), timer = null
  const note = id => {
    const version = versionOf(id)
    if (seen.get(id) === version || (version === 'gone' && !seen.has(id))) return
    if (version === 'gone') seen.delete(id); else seen.set(id, version)
    pending.add(id)
    timer ??= setTimeout(() => {
      const ids = pending
      pending = new Set()
      timer = null
      onChange(ids)
    }, DEBOUNCE_MS)
  }
  const watcher = fsWatch ? watch(dir, (_event, name) => {
    const id = sessionIdOfFile(name)
    if (id) note(id)
  }) : null
  watcher?.on('error', () => {}) // the folder can vanish (a test, a manual clean-up); clients keep their poll
  const scan = setInterval(() => {
    const now = new Set(fileIds())
    for (const id of now) note(id)
    for (const id of seen.keys()) if (!now.has(id)) note(id)
  }, SCAN_MS)
  return () => { clearTimeout(timer); clearInterval(scan); watcher?.close() }
}

// Returns { upgrade(req, socket, view), clientCount(), watching() }. `onChanged(ids)` runs before clients are told
// (e.g. to drop cached session lists). `related(id)`: session ids linked to a viewed session (see idsForView).
// Messages are JSON text: {"type":"hello","view":...} once, then {"type":"change","ids":[...]}.
export function createStreamHandler({ onChanged = () => {}, related = () => [], dir = SESSIONS_DIR } = {}) {
  const clients = new Set() // { view, ws }
  let stopWatching = null
  function broadcast(ids) {
    onChanged(ids)
    for (const c of clients) {
      const mine = idsForView(c.view, ids, related)
      if (mine.length) c.ws.send(JSON.stringify({ type: 'change', ids: mine }))
    }
  }
  function upgrade(req, socket, view) {
    if (clients.size >= MAX_CLIENTS) return refuseUpgrade(socket, 503, 'Service Unavailable', { 'retry-after': '10' })
    const ws = acceptWebSocket(req, socket)
    if (!ws) return
    ws.send(JSON.stringify({ type: 'hello', view }))
    const client = { view, ws }
    clients.add(client)
    if (!stopWatching) {
      try { stopWatching = watchSessions(broadcast, dir) } catch { stopWatching = null }
    }
    const ping = setInterval(ws.ping, PING_MS)
    ws.onClose(() => {
      clearInterval(ping)
      clients.delete(client)
      if (!clients.size && stopWatching) { stopWatching(); stopWatching = null }
    })
  }
  return { upgrade, clientCount: () => clients.size, watching: () => !!stopWatching }
}
