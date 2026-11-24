// Local web page for the subagent-deck mod: http://localhost:4791
// Each Claude session's mod writes live/sessions/<session-id>.json every 2 seconds; this serves them with
// totals read from the transcripts, and passes presses on the page back to the mod through inbox.jsonl.
// Usage: node server.mjs --help
import './lib/cli.mjs' // first: --help and bad options exit before anything starts
import { createServer } from 'node:http'
import { mkdirSync, readFileSync, statSync } from 'node:fs'
import { activeSessionIds, allMcpHistory, allSessions, knownWin, usageFor, windowChats, windowMs } from './lib/all-view.mjs'
import { costMath } from './lib/cost.mjs'
import { finishedAgents, warmLongTimeframes } from './lib/finished-agents.mjs'
import { sessionHistory, sessionMcp } from './lib/history.mjs'
import { readJsonBody, send, sendJson, sendJsonOr, sendStore } from './lib/http.mjs'
import { MAX_BODY_BYTES, refusal } from './lib/guard.mjs'
import { handleAction } from './lib/inbox.mjs'
import { backfill, EMPTY_MEMORY, readMemory, recordVote } from './lib/memory.mjs'
import { isId, PAGE_PATH, PORT, SESSIONS_DIR } from './lib/paths.mjs'
import { setResolved, trimResolved } from './lib/resolved.mjs'
import { deleteOldSessionFiles, hiddenVersion, isHidden, trimHidden, listSessions, rateLimits, rateLimitsAt, readSessionFile, setHidden } from './lib/sessions.mjs'
import { codexLimits } from './lib/codex-limits.mjs'
import { HOUR, SECOND } from './lib/time.mjs'
import { refreshUsage } from './lib/usage-store.mjs'

const USAGE_REFRESH_MS = 15 * SECOND // also picks up new transcripts
const WARM_START_DELAY_MS = 1 * SECOND
const RELOAD_POLL_MS = 2 * SECOND
const RELOAD_POLL_HIDDEN_MS = 30 * SECOND

mkdirSync(SESSIONS_DIR, { recursive: true }) // first run: the mod may not have written any yet
function tidyUp() {
  deleteOldSessionFiles()
  trimHidden()
  trimResolved()
}
tidyUp()
setInterval(tidyUp, HOUR)
setTimeout(warmLongTimeframes, WARM_START_DELAY_MS) // the usage store is already loaded from disk
refreshUsage()
setInterval(refreshUsage, USAGE_REFRESH_MS)

const param = (url, name) => url.searchParams.get(name)

// Finished agents without hidden sessions' ones. The same array is returned until either changes, so its large
// JSON (30 days can be megabytes) is built, hashed and gzipped once, and unchanged polls get 304.
const visibleCache = new Map() // ms -> { rows, hidden, list }
function visibleFinishedAgents(ms) {
  const rows = finishedAgents(ms), hidden = hiddenVersion()
  const hit = visibleCache.get(ms)
  if (hit && hit.rows === rows && hit.hidden === hidden) return hit.list
  const list = rows.filter(r => !isHidden(r.sessionOf))
  visibleCache.set(ms, { rows, hidden, list })
  return list
}

// Read-only routes (any method). `id=all` means the All sessions view.
const codexLimitsSafe = () => { try { return codexLimits() } catch { return null } }

const routes = {
  // limitsAt: when Claude's limits were last reported. codexLimits: the ChatGPT plan's, from Codex's logs (null without them).
  '/api/sessions': (res) => sendJson(res, { sessions: listSessions(), limits: rateLimits(), limitsAt: rateLimitsAt(), codexLimits: codexLimitsSafe() }),

  '/api/session': (res, url) => {
    if (param(url, 'id') === 'all') return sendJson(res, allSessions(knownWin(param(url, 'win')), activeSessionIds(url)))
    const id = param(url, 'id') ?? listSessions()[0]?.id
    if (!id || !isId(id)) return send(res, 200, 'application/json', 'null')
    sendJsonOr(res, 'null', () => readSessionFile(id))
  },

  '/api/math': (res, url) => {
    const id = param(url, 'id') ?? ''
    if (id === 'all') {
      const win = knownWin(param(url, 'win'))
      const d = usageFor(win, win === 'active' ? activeSessionIds(url) : null)
      return sendJson(res, { win, usd: d.usd, models: d.models, pace: d.pace, cache: null })
    }
    if (!isId(id)) return send(res, 200, 'application/json', 'null')
    sendJsonOr(res, 'null', () => costMath(id))
  },

  // Earlier agents: one session's subagents, or every finished agent in a timeframe.
  '/api/history': (res, url) => {
    const id = param(url, 'id') ?? ''
    if (id === 'all') return sendJsonOr(res, '[]', () => visibleFinishedAgents(windowMs(knownWin(param(url, 'win')))))
    if (!isId(id)) return send(res, 200, 'application/json', '[]')
    sendJsonOr(res, '[]', () => sessionHistory(id))
  },

  // The All view's "Previous orchestrators" for a timeframe.
  '/api/chats': (res, url) => sendJsonOr(res, '[]', () => windowChats(knownWin(param(url, 'win')))),

  '/api/mcp-history': (res, url) => {
    const id = param(url, 'id') ?? ''
    if (id === 'all') return sendJson(res, allMcpHistory())
    if (!isId(id)) return send(res, 200, 'application/json', '[]')
    sendJsonOr(res, '[]', () => sessionMcp(id))
  },

  '/api/memory': (res, url) => {
    const id = param(url, 'id') ?? ''
    const project = id === 'all' ? 'all' : listSessions().find(s => s.id === id)?.project
    sendJson(res, project ? readMemory(project) : EMPTY_MEMORY)
  },

  // Stores the mod writes: the server registry, short agent titles, what each finished agent did
  // ("main:<session>" for a session's main run), and agent grades.
  '/api/servers': (res) => sendStore(res, 'servers.json'),
  '/api/titles': (res) => sendStore(res, 'titles.json'),
  '/api/done': (res) => sendStore(res, 'done.json'),
  '/api/grades': (res) => sendStore(res, 'grades.json'),

  // The page's build time: open tabs reload when the page is rebuilt (data already updates live).
  '/api/build': (res) => {
    let v = 0
    try { v = statSync(PAGE_PATH).mtimeMs } catch {}
    sendJson(res, { v })
  },
}

const postRoutes = {
  // Save, on/off, grades, titles and done-lists, passed to the mod.
  '/api/action': (res, url, body) => {
    try { handleAction(body ?? {}) } catch {}
    send(res, 204, 'text/plain', '')
  },

  '/api/vote': (res, url, body) => {
    try {
      const vote = recordVote(body ?? {})
      if (vote === null) return send(res, 400, 'text/plain', '')
      sendJson(res, { vote })
    } catch {
      send(res, 400, 'text/plain', '')
    }
  },

  '/api/memory/backfill': (res, url) => {
    const id = param(url, 'id') ?? ''
    let queued = 0
    try { if (isId(id)) queued = backfill(id) } catch {}
    sendJson(res, { queued })
  },

  // Hide a session from the dashboard, or show it again with { unhide: true }. Never touches its files.
  '/api/hide': (res, url, a) => {
    try {
      const id = String(a?.id ?? '')
      if (!isId(id) || id === 'all') return send(res, 400, 'text/plain', '')
      setHidden(id, !a.unhide)
      sendJson(res, { id, hidden: !a.unhide })
    } catch {
      send(res, 400, 'text/plain', '')
    }
  },

  // Mark an agent that needs attention (stopped, failed, error) as resolved: { sessionId, runId }.
  '/api/resolve': (res, url, a) => {
    try {
      const sessionId = String(a?.sessionId ?? ''), runId = String(a?.runId ?? '')
      if (!isId(sessionId) || !setResolved(sessionId, runId)) return send(res, 400, 'text/plain', '')
      sendJson(res, { sessionId, runId, resolved: true })
    } catch {
      send(res, 400, 'text/plain', '')
    }
  },
}

// Everything else gets the page, with a small script that reloads it after a rebuild.
// While the tab is hidden it checks every RELOAD_POLL_HIDDEN_MS instead.
const RELOAD_SCRIPT = `<script>(() => { let v = null; const check = async () => { try { const n = (await (await fetch('/api/build')).json()).v; if (v !== null && n !== v) location.reload(); v = n } catch {} setTimeout(check, document.hidden ? ${RELOAD_POLL_HIDDEN_MS} : ${RELOAD_POLL_MS}) }; check() })()</script>`
function sendPage(res) {
  try {
    send(res, 200, 'text/html; charset=utf-8', readFileSync(PAGE_PATH, 'utf8').replace('</body>', RELOAD_SCRIPT + '</body>'))
  } catch {
    send(res, 500, 'text/plain', 'index.html missing')
  }
}

const server = createServer(async (req, res) => {
  const refused = refusal(req, PORT)
  if (refused) return send(res, refused.status, 'text/plain', refused.reason)
  const url = new URL(req.url ?? '/', 'http://localhost')
  try {
    const post = req.method === 'POST' && postRoutes[url.pathname]
    if (post) {
      let body
      try { body = await readJsonBody(req, MAX_BODY_BYTES) } catch (e) {
        if (e.status === 413) res.on('finish', () => req.destroy()) // don't read the rest
        return send(res, e.status ?? 400, 'text/plain', '')
      }
      await post(res, url, body)
    } else if (routes[url.pathname]) routes[url.pathname](res, url)
    else sendPage(res)
  } catch (error) {
    console.error(error)
    if (!res.headersSent) send(res, 500, 'text/plain', '')
  }
})

// Exits non-zero so a supervisor notices; launchd waits its throttle interval (10 s by default) before retrying.
server.on('error', error => {
  if (error.code === 'EADDRINUSE') console.error(`subagent-deck: port ${PORT} is already in use (another copy running?). Choose another with --port.`)
  else if (error.code === 'EACCES') console.error(`subagent-deck: not allowed to use port ${PORT}. Choose another with --port.`)
  else console.error(`subagent-deck: ${error.message}`)
  process.exit(1)
})
server.listen(PORT, '127.0.0.1', () => console.log(`subagent-deck on http://localhost:${PORT}`))
