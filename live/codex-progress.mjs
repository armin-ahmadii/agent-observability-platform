// The `progress` tool for Codex (GPT) helpers. Codex does not load Claude Code mods, so this is a small stdio
// MCP server it loads instead (registered in ~/.codex/config.toml as server `subagent-deck`). It offers the same
// tool, with the same name, input and descriptions as the mod's hooks/progress.ts.
//
// Which dashboard row a call belongs to:
//   1. Codex puts its own thread id on every tool call (`params._meta.threadId`).
//   2. T3 Code's database (read-only) maps that Codex thread to T3's child thread (`appThreadId`).
//   3. Exactly one delegated run in the mod's session files has that `childThreadId`: that run is the row.
// If any step finds nothing, or more than one match, nothing is written for that call (it is never guessed).
//
// What it writes: live/sessions/<codex thread id>.json, a helper session file in the mod's format (a `main` run
// with asks and plan/planSource/planDone/planNow/nowText/nowAt), so the page merges it into the delegated row like a Claude
// helper's own session. Activity and tokens come from Codex's own session log (rollout) for that thread.
// No dependencies. Node 22.13 or later (node:sqlite).
// It imports only lib modules with no side effects (live-dir, home-paths, t3-db): lib/paths.mjs parses the server's
// command line when loaded, which would reject or misread this process's arguments.
import { readdirSync, readFileSync, renameSync, statSync, writeFileSync, openSync, readSync, closeSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { CODEX_SESSIONS_DIR } from './lib/home-paths.mjs'
import { resolveLiveDir } from './lib/live-dir.mjs'
import { withT3Db } from './lib/t3-db.mjs'

const LIVE_DIR = resolveLiveDir() // SUBAGENT_DECK_LIVE, else this folder (same rule as the mod and the server)
const SESSIONS_DIR = join(LIVE_DIR, 'sessions')
const T3_DB_WAIT_MS = 200 // a progress call can wait a little longer for T3's database than a page request

const MAX_STEPS = 8
const TICK_MS = 2000 // the page treats a session file written in the last 10 s as open
const LOOKUP_GIVE_UP_MS = 10 * 60 * 1000 // keep trying to find the row this long after the last call
const KEEP_FRESH_AFTER_CALL_MS = 15 * 60 * 1000 // no rollout found: keep the file fresh this long after a call
const PARENT_MAX_AGE_MS = 7 * 24 * 3600 * 1000

// ---- the tool (same as hooks/progress.ts) ----
const PROGRESS_SPEC = {
  name: 'progress',
  description:
    "Report your progress to the owner's dashboard. Call at the start with the owner's request (`ask`) and your steps, then each time you start or finish a step, " +
    "and to say in 5 words or fewer what you're doing now. Steps are indexed from 0 in the order you gave them and belong to the current ask. Cheap; returns ok.",
  inputSchema: {
    type: 'object',
    properties: {
      ask: { type: 'string', description: 'The owner\'s request this work is for, 5–7 words, in the owner\'s terms (e.g. "Add resolve button to failed rows"). Send it on your first call and whenever you start on a new request; leave it out otherwise.' },
      steps: { type: 'array', items: { type: 'string' }, maxItems: MAX_STEPS, description: 'Your steps for the current ask, in order, each at most 6 words, imperative. Replaces the list; to add steps, send the whole list with the new ones at the end.' },
      done: { type: 'array', items: { type: 'integer' }, description: 'Indexes of steps now finished.' },
      current: { type: 'integer', description: 'Index of the step you are working on now.' },
      now: { type: 'string', description: "What you're doing right now, at most 5 words, e.g. \"Removing tooltips from Agents.tsx\"." },
    },
  },
}

const clip = (value, words, chars) =>
  String(value).replace(/\s+/g, ' ').trim().replace(/[.]+$/, '').split(' ').slice(0, words).join(' ').slice(0, chars)

// ---- asks: a copy of hooks/asks.ts (change both together) ----
// Each owner's request ("ask") owns its steps; plan/planSource/planDone/planNow mirror the latest ask.
// Codex calls arrive before the row's label is known, so an ask with no title yet is stored as '' and named
// after the row when the session file is written (titledAsks).
const MAX_ASKS = 20
const askTitle = v => (typeof v === 'string' ? clip(v, 7, 60) : '')

function closeIfDone(ask, at) {
  if (ask.finishedAt !== undefined) return ask
  return ask.steps.every((_, i) => ask.done.includes(i)) ? { ...ask, finishedAt: at } : ask
}

function mirror(run, asks) {
  const latest = asks[asks.length - 1]
  const next = { ...run, asks }
  if (!latest) return next
  if (latest.steps.length) Object.assign(next, { plan: latest.steps, planSource: 'agent', planDone: latest.done, planNow: latest.now })
  else if (run.planSource === 'agent') Object.assign(next, { plan: undefined, planSource: undefined, planDone: undefined, planNow: undefined })
  return next
}

function startAsk(run, title, at) {
  const asks = (run.asks ?? []).map((a, i, all) => (i === all.length - 1 ? closeIfDone(a, at) : a))
  return mirror(run, [...asks, { title, at, steps: [], done: [] }].slice(-MAX_ASKS))
}

function finishLatestAsk(run, at) {
  const latest = run.asks?.[run.asks.length - 1]
  if (!latest || latest.finishedAt !== undefined) return run
  return { ...run, asks: [...run.asks.slice(0, -1), { ...latest, finishedAt: at }] }
}

// Same rules as applyProgress in hooks/asks.ts (Codex helpers have no owner's-message asks, so no renaming).
function applyProgress(r, input, at) {
  const title = askTitle(input.ask)
  let next = r
  const latest = () => next.asks?.[next.asks.length - 1]
  if (title && latest()?.title !== title) next = startAsk(next, title, at)
  const hasUpdate = Array.isArray(input.steps) || Array.isArray(input.done) || input.current !== undefined || typeof input.now === 'string'
  if (!hasUpdate) return next
  if (!latest()) {
    if (next.planSource === 'agent' && next.plan?.length) {
      // Steps reported before asks existed: they become the first ask.
      next = { ...next, asks: [{ title: '', at, steps: next.plan, done: next.planDone ?? [], ...(next.planNow !== undefined ? { now: next.planNow } : {}) }] }
    } else if (Array.isArray(input.steps) && input.steps.some(x => typeof x === 'string' && x.trim())) {
      next = startAsk(next, '', at)
    } else {
      return typeof input.now === 'string' && input.now.trim() ? { ...next, nowText: clip(input.now, 5, 60), nowAt: at } : next
    }
  }
  const asks = [...next.asks]
  const ask = { ...asks[asks.length - 1] }
  if (Array.isArray(input.steps)) {
    const steps = input.steps.filter(x => typeof x === 'string' && x.trim()).map(x => clip(x, 6, 60)).slice(0, MAX_STEPS)
    if (steps.length) {
      ask.steps = steps
      ask.done = ask.done.filter(i => i < steps.length)
      if (ask.now !== undefined && ask.now >= steps.length) ask.now = undefined
    }
  }
  const n = ask.steps.length
  const valid = x => Number.isInteger(x) && x >= 0 && x < n
  if (Array.isArray(input.done)) {
    ask.done = [...new Set([...ask.done, ...input.done.filter(valid)])].sort((a, b) => a - b)
    if (ask.now !== undefined && ask.done.includes(ask.now)) ask.now = undefined
  }
  if (valid(input.current)) ask.now = input.current
  if (typeof input.now === 'string' && input.now.trim()) {
    ask.nowText = clip(input.now, 5, 60)
    next = { ...next, nowText: ask.nowText, nowAt: at }
  }
  if (ask.finishedAt !== undefined) delete ask.finishedAt
  asks[asks.length - 1] = ask
  return mirror(next, asks)
}

/** Untitled asks (steps sent before any `ask`) take the row's label. */
const titledAsks = (asks, label) => asks?.map(a => (a.title ? a : { ...a, title: askTitle(label) || 'Current task' }))

// ---- per Codex thread ----
/** threadId → { run, link, lastCallAt, rollout: { path, offset, rest, working, tokens, lastAt }, writtenDone } */
const threads = new Map()

function threadOf(threadId) {
  let t = threads.get(threadId)
  if (!t) {
    t = { run: null, link: null, lastCallAt: 0, rollout: null, writtenDone: false, startedAt: Date.now() }
    threads.set(threadId, t)
  }
  return t
}

const isCodexId = id => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)

function onProgress(threadId, input, meta) {
  const t = threadOf(threadId)
  const at = Date.now()
  t.lastCallAt = at
  t.model = meta?.model ?? t.model
  t.effort = meta?.reasoning_effort ?? t.effort
  t.run = applyProgress(t.run ?? existingRun(threadId) ?? {}, input, at)
  t.writtenDone = false
  tickThread(threadId, t)
  const ask = t.run.asks?.[t.run.asks.length - 1]
  const n = ask?.steps.length ?? 0
  return `ok${n ? ` (${ask.done.length}/${n} done)` : ''}`
}

// A file this thread already wrote (an earlier Codex process, e.g. after a restart): keep its progress.
function existingRun(threadId) {
  try {
    const main = JSON.parse(readFileSync(join(SESSIONS_DIR, `${threadId}.json`), 'utf8')).runs?.find(r => r.id === 'main')
    if (!main) return null
    const { plan, planSource, planDone, planNow, nowText, nowAt, asks } = main
    return { plan, planSource, planDone, planNow, nowText, nowAt, asks }
  } catch { return null }
}

// ---- attribution: Codex thread → T3 child thread → the one delegated run that names it ----
function t3AppThreadId(codexThreadId) {
  const apps = withT3Db(db => db.prepare(`SELECT DISTINCT json_extract(payload_json, '$.appThreadId') AS app
    FROM orchestration_v2_projection_provider_threads
    WHERE json_extract(payload_json, '$.driver') = 'codex' AND json_extract(payload_json, '$.nativeThreadRef.nativeId') = ?`).all(codexThreadId)
    .map(r => r.app).filter(Boolean), T3_DB_WAIT_MS)
  return apps?.length === 1 ? String(apps[0]) : null
}

function findDelegatedRun(appThreadId, ownFile) {
  const hits = []
  let names = []
  try { names = readdirSync(SESSIONS_DIR) } catch {}
  for (const name of names) {
    if (!name.endsWith('.json') || name === ownFile) continue
    const path = join(SESSIONS_DIR, name)
    try {
      const st = statSync(path)
      if (Date.now() - st.mtimeMs > PARENT_MAX_AGE_MS) continue
      const data = JSON.parse(readFileSync(path, 'utf8'))
      for (const r of data.runs ?? []) {
        if (r.type === 'delegated' && r.childThreadId === appThreadId) hits.push({ data, run: r, birth: st.birthtimeMs })
      }
    } catch {}
  }
  return hits.length === 1 ? hits[0] : null
}

function resolveLink(threadId) {
  const app = t3AppThreadId(threadId)
  if (!app) return null
  const hit = findDelegatedRun(app, `${threadId}.json`)
  if (!hit) return null
  return {
    appThreadId: app,
    parentSessionId: hit.data.sessionId,
    runId: hit.run.id,
    label: hit.run.label,
    brief: hit.run.brief ?? '',
    project: hit.data.project,
    model: hit.run.model,
    effort: hit.run.effort,
    startedAt: hit.run.startedAt,
  }
}

// ---- Codex's own log for the thread: working or not, and tokens ----
function findRollout(threadId) {
  const suffix = `-${threadId}.jsonl`
  // Newest day folders first (sessions/YYYY/MM/DD).
  const sortedDirs = p => { try { return readdirSync(p).filter(n => /^\d+$/.test(n)).sort().reverse() } catch { return [] } }
  for (const y of sortedDirs(CODEX_SESSIONS_DIR)) {
    for (const m of sortedDirs(join(CODEX_SESSIONS_DIR, y))) {
      for (const d of sortedDirs(join(CODEX_SESSIONS_DIR, y, m))) {
        const dir = join(CODEX_SESSIONS_DIR, y, m, d)
        try {
          const f = readdirSync(dir).find(n => n.endsWith(suffix))
          if (f) return join(dir, f)
        } catch {}
      }
    }
  }
  return null
}

function readRollout(t, threadId) {
  if (!t.rollout) {
    const path = findRollout(threadId)
    if (!path) return
    t.rollout = { path, offset: 0, rest: '', working: null, tokens: 0, lastAt: 0, firstAt: 0 }
  }
  const ro = t.rollout
  let size = 0
  try { size = statSync(ro.path).size } catch { return }
  if (size <= ro.offset) return
  const fd = openSync(ro.path, 'r')
  try {
    const buf = Buffer.alloc(size - ro.offset)
    readSync(fd, buf, 0, buf.length, ro.offset)
    ro.offset = size
    const lines = (ro.rest + buf.toString('utf8')).split('\n')
    ro.rest = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.includes('"event_msg"') && !line.includes('"session_meta"')) continue
      let d
      try { d = JSON.parse(line) } catch { continue }
      const at = Date.parse(d.timestamp ?? '') || 0
      if (d.type === 'session_meta' && at) ro.firstAt ||= at
      if (d.type !== 'event_msg') continue
      const p = d.payload ?? {}
      if (at) ro.lastAt = Math.max(ro.lastAt, at)
      if (p.type === 'task_started') ro.working = true
      else if (p.type === 'task_complete' || p.type === 'turn_aborted') ro.working = false
      else if (p.type === 'token_count') {
        const u = p.info?.total_token_usage
        // Counted like the dashboard counts Claude replies: new input + output, cache reads left out.
        if (u) ro.tokens = Math.max(0, (u.input_tokens ?? 0) - (u.cached_input_tokens ?? 0)) + (u.output_tokens ?? 0)
      }
    }
  } finally { closeSync(fd) }
}

// ---- writing the helper session file ----
function writeSession(threadId, t, working) {
  const L = t.link
  const ro = t.rollout
  const startedAt = ro?.firstAt || t.startedAt
  const main = {
    id: 'main',
    label: L.label,
    brief: L.brief,
    type: 'main',
    now: working ? 'running' : 'done',
    startedAt,
    segments: [],
    mcp: {},
    usd: 0,
    tokens: ro?.tokens ?? 0,
    costKnown: false, // no price list for GPT models here
    model: t.model ?? L.model,
    effort: t.effort ?? L.effort,
    ...(t.run ?? {}),
  }
  if (main.asks) main.asks = titledAsks(main.asks, L.label)
  const path = join(SESSIONS_DIR, `${threadId}.json`)
  // Each write replaces the file (new birth time), so the session's start is kept inside it, set once.
  t.fileStartedAt ??= startedAtInFile(path) ?? startedAt
  const data = {
    sessionId: threadId,
    project: L.project,
    startedAt: t.fileStartedAt,
    updatedAt: Date.now(),
    totalUsd: 0,
    costKnown: false,
    // The page and server name a helper's session after its task; Codex has no Claude transcript to read it from.
    title: L.label,
    provider: 'codex',
    delegatedBy: { sessionId: L.parentSessionId, runId: L.runId, childThreadId: L.appThreadId },
    runs: [main],
  }
  const tmp = `${path}.tmp`
  try {
    writeFileSync(tmp, JSON.stringify(data))
    renameSync(tmp, path)
  } catch {}
}

function startedAtInFile(path) {
  try { return Number(JSON.parse(readFileSync(path, 'utf8')).startedAt) || null } catch { return null }
}

function tickThread(threadId, t) {
  const now = Date.now()
  if (!t.link) {
    if (now - t.lastCallAt > LOOKUP_GIVE_UP_MS) return // never found its row: dropped
    t.link = resolveLink(threadId)
    if (!t.link) return
  }
  readRollout(t, threadId)
  const working = t.rollout?.working ?? (now - t.lastCallAt < KEEP_FRESH_AFTER_CALL_MS)
  if (working) { t.writtenDone = false; writeSession(threadId, t, true) }
  else if (!t.writtenDone) {
    if (t.run) t.run = finishLatestAsk(t.run, now) // the helper's turn is over
    writeSession(threadId, t, false)
    t.writtenDone = true
  }
}

setInterval(() => { for (const [id, t] of threads) tickThread(id, t) }, TICK_MS).unref()

// ---- MCP over stdio (newline-delimited JSON-RPC) ----
const send = m => process.stdout.write(JSON.stringify(m) + '\n')
const reply = (id, result) => send({ jsonrpc: '2.0', id, result })

function handle(m) {
  if (!m || typeof m !== 'object' || m.id === undefined) return // notifications
  switch (m.method) {
    case 'initialize':
      return reply(m.id, {
        protocolVersion: m.params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'subagent-deck', version: '1.0.0' },
      })
    case 'ping':
      return reply(m.id, {})
    case 'tools/list':
      return reply(m.id, { tools: [PROGRESS_SPEC] })
    case 'tools/call': {
      if (m.params?.name !== PROGRESS_SPEC.name) {
        return send({ jsonrpc: '2.0', id: m.id, error: { code: -32602, message: `Unknown tool: ${m.params?.name}` } })
      }
      const meta = m.params?._meta ?? {}
      const turn = meta['x-codex-turn-metadata'] ?? {}
      const threadId = meta.threadId ?? turn.thread_id
      const input = m.params?.arguments && typeof m.params.arguments === 'object' ? m.params.arguments : {}
      let text = 'ok'
      try { if (isCodexId(threadId)) text = onProgress(threadId, input, turn) } catch {}
      return reply(m.id, { content: [{ type: 'text', text }] })
    }
    default:
      return send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `Method not found: ${m.method}` } })
  }
}

createInterface({ input: process.stdin }).on('line', line => {
  let m
  try { m = JSON.parse(line) } catch { return }
  try { handle(m) } catch {}
})
process.stdin.on('end', () => {
  // Codex closed us: write each thread's final state once, then exit.
  for (const [id, t] of threads) { try { tickThread(id, t) } catch {} }
  process.exit(0)
})
