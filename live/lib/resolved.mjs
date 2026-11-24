// Agents marked resolved on the page: their needs-attention marker is dropped, for the dashboard only
// (the session files are never changed). { "<sessionId>:<runId>": resolvedAt } in live/resolved.json.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { livePath, sessionPath } from './paths.mjs'
import { DAY } from './time.mjs'

const resolvedPath = livePath('resolved.json')
let resolved = {}
try { resolved = JSON.parse(readFileSync(resolvedPath, 'utf8')) ?? {} } catch {}
const keyOf = (sessionId, runId) => `${sessionId}:${runId}`
const MAX_RUN_ID = 200
const KEEP_MS = 31 * DAY
const save = () => { try { writeFileSync(resolvedPath, JSON.stringify(resolved, null, 1) + '\n') } catch {} }

// Entries older than 31 days, or for sessions whose file is gone (nothing left to mark).
export function trimResolved() {
  let changed = false
  for (const [key, at] of Object.entries(resolved)) {
    const sessionId = key.slice(0, key.indexOf(':'))
    if (Date.now() - at > KEEP_MS || !existsSync(sessionPath(sessionId))) { delete resolved[key]; changed = true }
  }
  if (changed) save()
}

export function setResolved(sessionId, runId) {
  if (!runId || runId.length > MAX_RUN_ID) return false
  resolved[keyOf(sessionId, runId)] = Date.now()
  save()
  return true
}

// Resolved, and no new work since: an agent that runs again and needs you again shows its marker again.
export function isResolved(sessionId, run) {
  const at = resolved[keyOf(sessionId, run.id)]
  if (!at) return false
  const last = Math.max(Number(run.endedAt) || 0, ...(run.segments ?? []).map(s => s.end ?? 0))
  return last <= at
}
const hasResolved = sessionId => Object.keys(resolved).some(k => k.startsWith(sessionId + ':'))

// A session file's data with resolved runs' attention removed.
export function applyResolved(data) {
  if (!data?.sessionId || !Array.isArray(data.runs) || !hasResolved(data.sessionId)) return data
  data.runs = data.runs.map(r => r.attention && isResolved(data.sessionId, r) ? { ...r, attention: undefined } : r)
  return data
}
