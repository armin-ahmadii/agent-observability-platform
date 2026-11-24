// Session names: T3 Code's name for the chat, else the transcript's title, else the first message.
import { statSync } from 'node:fs'
import { withT3Db } from './t3-db.mjs'
import { SECOND } from './time.mjs'
import { cleanText, contentText, linesOf, mainTranscript } from './transcripts.mjs'

const FIRST_MESSAGE_CHARS = 120

// The last title Claude Code saved (one you or T3 set, else the one it made up), else your first message.
// Only the bytes added since the last read are read, and only complete lines are parsed.
// Also collects the tasks handed to T3 helpers.
const titleCache = new Map()
function readTitle(path) {
  const size = statSync(path).size
  const hit = titleCache.get(path)
  if (hit && hit.size === size) return hit
  const from = hit && size >= hit.offset ? hit.offset : 0 // a file that shrank was rewritten: start over
  const fresh = from === 0
  let title = fresh ? null : hit.title, custom = fresh ? false : hit.custom, first = fresh ? null : hit.first
  const delegated = fresh ? new Set() : hit.delegated
  const state = {}
  for (const line of linesOf(path, from, state)) {
    if (line.includes('delegate_task"') && line.includes('"tool_use"')) {
      try {
        for (const c of JSON.parse(line).message?.content ?? []) {
          if (c.type === 'tool_use' && /delegate_task$/.test(c.name) && c.input?.title) delegated.add(String(c.input.title))
        }
      } catch {}
      continue
    }
    if (!first && line.includes('"type":"user"') && !line.includes('"isSidechain":true')) {
      try {
        const t = cleanText(contentText(JSON.parse(line).message?.content, ' '))
        if (t && !t.startsWith('<') && !/^(Delegated task|\[SYSTEM)/.test(t)) first = t.replace(/\s+/g, ' ').slice(0, FIRST_MESSAGE_CHARS)
      } catch {}
      continue
    }
    if (!line.includes('-title"')) continue
    try {
      const d = JSON.parse(line)
      if (d.type === 'custom-title' && d.customTitle) { title = d.customTitle; custom = true }
      else if (d.type === 'ai-title' && !custom && d.aiTitle) title = d.aiTitle
    } catch {}
  }
  const entry = { size, offset: state.end ?? from, title, custom, delegated, first }
  titleCache.set(path, entry)
  return entry
}

function transcriptTitle(sessionId) {
  const path = mainTranscript(sessionId)
  if (!path) return null
  const t = readTitle(path)
  return t.title ?? t.first
}

// Titles of the tasks a session handed to T3 helpers. A helper's own session takes its task's title.
export function delegatedTitles(sessionId) {
  const path = mainTranscript(sessionId)
  return path ? [...readTitle(path).delegated] : []
}

// T3's names for its chats (what its sidebar shows), read-only from its database. A Claude session id is
// the T3 provider thread's native id. Missing or busy database: no names.
const T3_REFRESH_MS = 10 * SECOND
let t3Names = new Map(), t3ReadAt = 0
function t3Title(sessionId) {
  if (Date.now() - t3ReadAt > T3_REFRESH_MS) {
    t3ReadAt = Date.now()
    const rows = withT3Db(db => db.prepare(`SELECT json_extract(p.payload_json, '$.nativeThreadRef.nativeId') AS sid, t.title AS title
          FROM orchestration_v2_projection_provider_threads p
          JOIN orchestration_v2_projection_threads t ON t.thread_id = json_extract(p.payload_json, '$.appThreadId')
          WHERE json_extract(p.payload_json, '$.driver') = 'claudeAgent' AND t.deleted_at IS NULL`).all())
    if (rows) t3Names = new Map(rows.filter(r => r.sid && r.title).map(r => [String(r.sid), String(r.title)]))
  }
  return t3Names.get(sessionId) ?? null
}

// The name the dashboard shows; null when nothing can be read.
export function displayTitle(sessionId) {
  try { return t3Title(sessionId) ?? transcriptTitle(sessionId) } catch { return null }
}
export function safeTranscriptTitle(sessionId) {
  try { return transcriptTitle(sessionId) } catch { return null }
}
