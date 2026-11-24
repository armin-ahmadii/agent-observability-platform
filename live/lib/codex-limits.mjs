// Codex (ChatGPT plan) usage limits, read-only from Codex's own session logs:
// <CODEX_HOME or ~/.codex>/sessions/YYYY/MM/DD/rollout-*.jsonl hold token_count events with
// "rate_limits": { primary: { used_percent, window_minutes, resets_at }, secondary, plan_type }.
// Many events carry null windows, so the newest reading with a window wins, across recent files.
// Each file is read once (backwards from its end until a reading turns up), then only its new bytes.
import { closeSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { CODEX_SESSIONS_DIR } from './home-paths.mjs'
import { DAY, SECOND } from './time.mjs'

const LOOKBACK_DAYS = 8 // the longest window Codex reports is a week
const RELIST_MS = 15 * SECOND // look for new or grown files at most this often
const CHUNK_BYTES = 256 * 1024

// The newest reading with a window among the lines of `text`, or null. A reading: { at, rl }.
function newestReading(text) {
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (!line.includes('"rate_limits"') || !line.includes('"used_percent"')) continue
    try {
      const d = JSON.parse(line)
      const rl = d.payload?.rate_limits ?? d.rate_limits
      if (rl && (rl.primary || rl.secondary)) return { at: Date.parse(d.timestamp) || 0, rl }
    } catch {}
  }
  return null
}

// The byte offset just after the file's last newline (a line still being written is left for later).
function fullLinesEnd(fd, size) {
  for (let pos = size; pos > 0;) {
    const from = Math.max(0, pos - CHUNK_BYTES)
    const buf = Buffer.alloc(pos - from)
    readSync(fd, buf, 0, buf.length, from)
    const i = buf.lastIndexOf(0x0a)
    if (i >= 0) return from + i + 1
    pos = from
  }
  return 0
}

function readRange(fd, from, to) {
  const buf = Buffer.alloc(to - from)
  readSync(fd, buf, 0, buf.length, from)
  return buf.toString('utf8')
}

// The reader for one sessions folder (a function so tests can point it at a fixture folder).
export function codexLimitsReader(dir = CODEX_SESSIONS_DIR) {
  const files = new Map() // path → { size: bytes read up to the last full line, best: reading | null }
  let result = null, checkedAt = 0

  function scanFile(path, size) {
    const f = files.get(path)
    if (f && f.size >= size) return f
    const fd = openSync(path, 'r')
    try {
      if (f) {
        // Appended lines only.
        const end = fullLinesEnd(fd, size)
        if (end <= f.size) return f
        const best = newestReading(readRange(fd, f.size, end))
        const next = { size: end, best: best ?? f.best }
        files.set(path, next)
        return next
      }
      // First look: backwards from the end, a chunk at a time, until a reading turns up.
      const lastNl = fullLinesEnd(fd, size)
      let best = null, pos = lastNl, carry = ''
      while (pos > 0 && !best) {
        const from = Math.max(0, pos - CHUNK_BYTES)
        const text = readRange(fd, from, pos) + carry
        const firstNl = from > 0 ? text.indexOf('\n') : -1
        best = newestReading(firstNl >= 0 ? text.slice(firstNl + 1) : text)
        carry = firstNl >= 0 ? text.slice(0, firstNl + 1) : ''
        pos = from
      }
      if (!best && carry) best = newestReading(carry)
      const next = { size: lastNl, best }
      files.set(path, next)
      return next
    } finally { closeSync(fd) }
  }

  function recentFiles(now) {
    const out = []
    for (let d = 0; d < LOOKBACK_DAYS; d++) {
      const t = new Date(now - d * DAY)
      const day = join(dir, String(t.getFullYear()), String(t.getMonth() + 1).padStart(2, '0'), String(t.getDate()).padStart(2, '0'))
      let names = []
      try { names = readdirSync(day) } catch { continue }
      for (const n of names) {
        if (!n.startsWith('rollout-') || !n.endsWith('.jsonl')) continue
        try { const st = statSync(join(day, n)); out.push({ path: join(day, n), size: st.size, mtime: st.mtimeMs }) } catch {}
      }
    }
    return out.sort((a, b) => b.mtime - a.mtime)
  }

  function compute(now) {
    let best = null
    for (const f of recentFiles(now)) {
      if (best && best.at >= f.mtime) break // this file (and every older one) ends before the reading we have
      let r = null
      try { r = scanFile(f.path, f.size).best } catch { continue }
      if (r && (!best || r.at > best.at)) best = r
    }
    return best && shape(best, now)
  }

  return function codexLimits(now = Date.now()) {
    if (now - checkedAt >= RELIST_MS) { checkedAt = now; result = compute(now) }
    return result
  }
}

// { plan, at, limits: [{ window, minutes, percentUsed, resetsAt }] }. A window whose reset time has passed is back to 0%.
function shape({ at, rl }, now) {
  const limits = []
  for (const window of ['primary', 'secondary']) {
    const w = rl[window]
    if (!w || typeof w.used_percent !== 'number') continue
    const resetMs = Number(w.resets_at) * 1000 || 0
    const reset = resetMs > 0 && resetMs <= now
    limits.push({ window, minutes: Number(w.window_minutes) || null, percentUsed: reset ? 0 : w.used_percent, resetsAt: resetMs && !reset ? new Date(resetMs).toISOString() : null })
  }
  return limits.length ? { plan: typeof rl.plan_type === 'string' ? rl.plan_type : null, at, limits } : null
}

export const codexLimits = codexLimitsReader()
