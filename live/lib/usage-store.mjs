// Every session's cost and tokens per hour and per model, for the last 31 days. Transcripts are read once, then
// only their new bytes, in the background (newest files first). Kept on disk (usage-hours.json) so a restart only
// reads what was added since. Every window (24h, 7d, 30d, the week's limit share) is a sum over these hourly
// buckets, so it is fast and never re-reads a whole transcript.
import { closeSync, openSync, readdirSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { livePath, PROJECTS_DIR } from './paths.mjs'
import { cacheWrites, priceParts, replyTokens, replyUsd } from './pricing.mjs'
import { MINUTE, HOUR, DAY, SECOND, yieldToEventLoop } from './time.mjs'
import { isSubagentFile, parseReply } from './transcripts.mjs'

const KEEP_MS = 31 * DAY
const RECENT_MS = 15 * MINUTE // replies kept in memory for the "last 10 min" pace
const PACE_MS = 10 * MINUTE
const READ_CHUNK_BYTES = 8 << 20
const BACKGROUND_BUDGET_BYTES = 16 << 20 // per step, so a big file never blocks page requests for long
const SAVE_EVERY_MS = 10 * SECOND
const CATCH_UP_EVERY_MS = 2 * SECOND
const CATCH_UP_MAX_AGE_MS = 2 * DAY
const WINDOW_CACHE_MS = 3 * SECOND
const WINDOW_CACHE_MS_WARMING = 500
const WINDOW_CACHE_SIZE = 40
const storePath = livePath('usage-hours.json')

// Bucket values, by index.
const USD = 0, TOKENS = 1, INPUT = 2, OUTPUT = 3, WRITE_5M = 4, WRITE_1H = 5, READ = 6, REPLIES = 7
const BUCKET_SIZE = 8

// file -> { s: session, b: 1 if a subagent transcript, p: bytes read (to the last full line), m: mtime, a: last reply time,
//           l: last message id, lc: [hour, model, ...values] it added (a message's lines repeat; the last one counts),
//           h: { hourStart: { model: [usd, tokens, input, output, write5m, write1h, read, replies] } } }
let files = {}
try { files = JSON.parse(readFileSync(storePath, 'utf8')).files ?? {} } catch {}
const reading = new Map() // file -> { rest, seen, pos } for this run only
let dirty = false
const recent = [] // [at, usd, id] of replies read in this run within RECENT_MS

// A subagent transcript belongs to the session folder it sits in.
function sessionOfFile(path) {
  const parts = path.split('/')
  const i = parts.indexOf('subagents')
  return i > 0 ? parts[i - 1] : basename(path, '.jsonl')
}

// Every transcript changed since `since`, newest first.
function listTranscripts(since) {
  const out = []
  const walk = d => {
    let entries = []
    try { entries = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const f = join(d, e.name)
      if (e.isDirectory()) { if (e.name !== 'memory' && e.name !== 'tool-results') walk(f) }
      else if (e.name.endsWith('.jsonl')) { try { const m = statSync(f).mtimeMs; if (m >= since) out.push([f, m]) } catch {} }
    }
  }
  walk(PROJECTS_DIR)
  return out.sort((a, b) => b[1] - a[1]).map(x => x[0])
}

function addToBucket(f, hour, model, v, sign) {
  const models = (f.h[hour] ??= {})
  const b = (models[model] ??= new Array(BUCKET_SIZE).fill(0))
  for (let i = 0; i < BUCKET_SIZE; i++) b[i] += sign * v[i]
}

// Reads up to `budget` new bytes; returns true when the file is read to its end.
function readNew(path, budget = Infinity) {
  let st
  try { st = statSync(path) } catch { return true }
  let f = files[path]
  if (!f || st.size < f.p) {
    f = files[path] = { s: sessionOfFile(path), b: isSubagentFile(path) ? 1 : 0, p: 0, m: 0, a: 0, h: {} }
    reading.delete(path)
  }
  f.m = st.mtimeMs
  const r = reading.get(path) ?? reading.set(path, { rest: '', seen: new Set(), pos: f.p }).get(path)
  if (st.size <= r.pos) return true
  const end = Math.min(st.size, r.pos + budget)
  const fd = openSync(path, 'r')
  const buf = Buffer.alloc(Math.min(READ_CHUNK_BYTES, end - r.pos))
  const cutoff = Date.now() - KEEP_MS
  try {
    while (r.pos < end) {
      const n = readSync(fd, buf, 0, Math.min(buf.length, end - r.pos), r.pos)
      if (n <= 0) break
      r.pos += n
      const lines = (r.rest + buf.toString('utf8', 0, n)).split('\n')
      r.rest = lines.pop() ?? ''
      for (const line of lines) if (line.includes('"usage"')) addReply(f, r, line, cutoff)
    }
  } finally { closeSync(fd) }
  f.p = r.pos - Buffer.byteLength(r.rest)
  dirty = true
  return r.pos >= st.size
}

function addReply(f, r, line, cutoff) {
  const reply = parseReply(line)
  if (!reply) return
  const { id, model, u, at } = reply
  if (id === f.l && f.lc) addToBucket(f, f.lc[0], f.lc[1], f.lc.slice(2), -1) // the same reply again: its last line counts
  else if (r.seen.has(id)) return
  r.seen.add(id)
  f.l = id
  f.lc = null
  if (at < cutoff) return
  const usd = replyUsd(model, u)
  const { w5m, w1h } = cacheWrites(u)
  const v = [usd, replyTokens(u), u.input_tokens ?? 0, u.output_tokens ?? 0, w5m, w1h, u.cache_read_input_tokens ?? 0, 1]
  const hour = at - (at % HOUR)
  addToBucket(f, hour, model, v, 1)
  f.lc = [hour, model, ...v]
  f.a = Math.max(f.a, at)
  if (Date.now() - at < RECENT_MS) {
    if (recent.at(-1)?.[2] === id) recent.pop()
    recent.push([at, usd, id])
  }
}

function prune() {
  const old = Date.now() - KEEP_MS
  for (const [path, f] of Object.entries(files)) {
    for (const h of Object.keys(f.h)) if (Number(h) < old) { delete f.h[h]; dirty = true }
    if (!Object.keys(f.h).length && f.m < old) { delete files[path]; reading.delete(path); dirty = true }
  }
  while (recent.length && Date.now() - recent[0][0] > RECENT_MS) recent.shift()
}

function save() {
  if (!dirty) return
  dirty = false
  try { writeFileSync(storePath + '.tmp', JSON.stringify({ v: 1, files })); renameSync(storePath + '.tmp', storePath) } catch {}
}

let refreshing = false
// False until the first full pass after the server starts; until then results are not cached for long.
let ready = false
export const isUsageReady = () => ready

// One background pass over every recent transcript.
export async function refreshUsage() {
  if (refreshing) return
  refreshing = true
  let savedAt = Date.now()
  try {
    for (const f of listTranscripts(Date.now() - KEEP_MS)) {
      while (!readNew(f, BACKGROUND_BUDGET_BYTES)) await yieldToEventLoop()
      await yieldToEventLoop()
      if (Date.now() - savedAt > SAVE_EVERY_MS) { save(); savedAt = Date.now() }
    }
    prune()
    save()
    ready = true
  } finally { refreshing = false }
}

// Reads the new lines of files that grew since the last pass, so numbers stay live between passes.
let caughtUpAt = 0
function catchUp() {
  if (!ready || Date.now() - caughtUpAt < CATCH_UP_EVERY_MS) return
  caughtUpAt = Date.now()
  for (const [path, f] of Object.entries(files)) {
    if (Date.now() - f.m > CATCH_UP_MAX_AGE_MS) continue
    let st
    try { st = statSync(path) } catch { continue }
    if (st.size > (reading.get(path)?.pos ?? f.p)) readNew(path)
  }
}

// Each session's share of the week's limit. usedPct: the account's weekly % used; windowStart: when the week began.
export function weeklyShares(usedPct, windowStart) {
  const per = new Map()
  let total = 0
  for (const f of Object.values(files)) {
    for (const [h, models] of Object.entries(f.h)) {
      if (Number(h) + HOUR <= windowStart) continue
      const x = per.get(f.s) ?? { usd: 0, tok: 0 }
      for (const b of Object.values(models)) { x.usd += b[USD]; x.tok += b[TOKENS] + b[READ]; total += b[USD] }
      per.set(f.s, x)
    }
  }
  const out = {}
  for (const [id, x] of per) out[id] = { pct: total > 0 && usedPct != null ? usedPct * x.usd / total : null, tokens: x.tok, usd: x.usd }
  return { total, out }
}

// Every session's usage in hours that started within the last `ms` (so a window is up to an hour shorter at its
// far end). `only`: limit to these session ids. Totals, who spent it, per-session amounts, per-model math.
const windowCache = new Map()
export function usageWindow(ms, only = null) {
  catchUp()
  const key = ms + '|' + (only ? [...only].sort().join(',') : '')
  const hit = windowCache.get(key)
  if (hit && Date.now() - hit.at < (ready ? WINDOW_CACHE_MS : WINDOW_CACHE_MS_WARMING)) return hit
  const now = Date.now()
  const from = now - ms
  const firstHour = from - (from % HOUR)
  const per = {}, sessions = new Set(), subs = new Set(), bySession = {}
  let usd = 0, tokens = 0, mainUsd = 0, subUsd = 0
  for (const [path, f] of Object.entries(files)) {
    if (only && !only.has(f.s)) continue
    for (const [h, models] of Object.entries(f.h)) {
      if (Number(h) < firstHour) continue
      for (const [model, b] of Object.entries(models)) {
        if (!b[REPLIES]) continue
        usd += b[USD]; tokens += b[TOKENS]
        if (f.b) { subUsd += b[USD]; subs.add(path) } else mainUsd += b[USD]
        sessions.add(f.s)
        const x = (bySession[f.s] ??= { usd: 0, tokens: 0, mainUsd: 0, mainTokens: 0, last: 0, models: {} })
        x.usd += b[USD]; x.tokens += b[TOKENS]
        if (!f.b) { x.mainUsd += b[USD]; x.mainTokens += b[TOKENS]; x.models[model] = (x.models[model] ?? 0) + b[USD] }
        x.last = Math.max(x.last, f.a)
        const row = (per[model] ??= { model, requests: 0, input: 0, output: 0, write5m: 0, write1h: 0, read: 0 })
        row.requests += b[REPLIES]; row.input += b[INPUT]; row.output += b[OUTPUT]; row.write5m += b[WRITE_5M]; row.write1h += b[WRITE_1H]; row.read += b[READ]
      }
    }
  }
  // A session's model: the one its main conversation spent most on.
  for (const x of Object.values(bySession)) { x.model = Object.entries(x.models).sort((a, b) => b[1] - a[1])[0]?.[0]; delete x.models }
  const models = Object.values(per)
    .map(r => ({ model: r.model, requests: r.requests, ...priceParts(r.model, r) }))
    .sort((a, b) => b.usd - a.usd)
  const last10 = recent.filter(([at]) => now - at < PACE_MS).reduce((a, [, u]) => a + u, 0)
  const res = { at: now, from, usd, tokens, mainUsd, subUsd, chats: sessions.size, subs: subs.size, sessions: [...sessions], bySession, models, pace: { last10 } }
  windowCache.set(key, res)
  if (windowCache.size > WINDOW_CACHE_SIZE) windowCache.delete(windowCache.keys().next().value)
  return res
}
