// Your past messages in a session, each with the work you had just seen: the main conversation's last answer,
// subagents that finished since your previous message, and T3 helpers that finished then. Used to backfill
// project memory.
import { statSync } from 'node:fs'
import { readTrace, sessionHistory } from './history.mjs'
import { cleanText, contentText, linesOf, mainTranscript, stripNotebook } from './transcripts.mjs'

const MESSAGE_CHARS = 2500
const RESULT_CHARS = 600
const MAX_CANDIDATES = 8

// `children`: the T3 helper sessions this session delegated to ({ id, title }).
export function pastPrompts(sessionId, children = []) {
  const path = mainTranscript(sessionId)
  if (!path) return []
  const subagents = sessionHistory(sessionId)
  const helpers = children.map(c => {
    const p = mainTranscript(c.id)
    if (!p) return null
    let end = 0
    try { end = statSync(p).mtimeMs } catch {}
    return { id: `task:${c.title}`, label: c.title, kind: 'delegated', result: readTrace(p).result, end }
  }).filter(Boolean)
  const out = []
  let lastAnswer = '', prevAt = 0, model
  for (const line of linesOf(path)) {
    if (!line) continue
    let d
    try { d = JSON.parse(line) } catch { continue }
    if (d.isSidechain || d.isMeta) continue
    const at = Date.parse(d.timestamp) || 0
    const c = d.message?.content
    if (d.type === 'assistant') {
      model = d.message?.model ?? model
      for (const b of Array.isArray(c) ? c : []) if (b.type === 'text' && b.text?.trim()) lastAnswer = b.text
      continue
    }
    if (d.type !== 'user') continue
    const text = cleanText(contentText(c, '\n'))
    if (!text || /^(Delegated task|<task-notification>|\[SYSTEM NOTIFICATION)/.test(text) || text.startsWith('This session is being continued')) continue
    if (Array.isArray(c) && c.some(b => b.type === 'tool_result')) continue
    const finishedSinceLast = end => end > prevAt && end <= at
    const candidates = [{ id: `main:${sessionId}`, label: 'Main conversation', model, kind: 'main', result: stripNotebook(lastAnswer).slice(0, RESULT_CHARS) }]
    for (const s of subagents) if (finishedSinceLast(s.endedAt)) candidates.push({ id: s.id, label: s.label, model: s.model, kind: 'subagent', result: (s.result ?? '').slice(0, RESULT_CHARS) })
    for (const h of helpers) if (finishedSinceLast(h.end)) candidates.push({ id: h.id, label: h.label, kind: h.kind, result: (h.result ?? '').slice(0, RESULT_CHARS) })
    out.push({ at, text: text.slice(0, MESSAGE_CHARS), candidates: candidates.slice(0, MAX_CANDIDATES) })
    prevAt = at
  }
  return out
}
