// Presses on the page reach the mod as lines in inbox.jsonl, each addressed to one session; that session's mod
// reads and acts on them. Work any session can do (titles, grades, done-lists) goes to an open one.
import { appendFileSync } from 'node:fs'
import { INBOX_PATH } from './paths.mjs'
import { openSessions } from './sessions.mjs'

const MAX_ITEMS = 60
const LABEL_CHARS = 200
const TITLE_BRIEF_CHARS = 600
const DONE_BRIEF_CHARS = 2500
const DONE_RESULT_CHARS = 3500

export const appendInbox = (...messages) => appendFileSync(INBOX_PATH, messages.map(m => JSON.stringify(m) + '\n').join(''))

// The open session addressed, else the newest open one.
const openTarget = id => {
  const open = openSessions()
  return open.find(s => s.id === id) ?? open[0]
}

// One press from POST /api/action.
export function handleAction(a) {
  if (typeof a.sessionId === 'string' && (a.kind === 'save' || a.kind === 'toggle' || a.kind === 'grade')) {
    // A grade addressed to "all" or to a closed session goes to the newest open one, so it is not left unread.
    if (a.kind === 'grade') a.sessionId = openTarget(a.sessionId)?.id
    if (a.sessionId) appendInbox(a)
  }
  // Titles can be for any session (closed ones too).
  if (a.kind === 'title' && Array.isArray(a.items) && a.items.length) {
    const target = openSessions()[0]
    const items = a.items.slice(0, MAX_ITEMS)
      .map(x => ({ key: String(x?.key ?? ''), label: String(x?.label ?? '').slice(0, LABEL_CHARS), brief: String(x?.brief ?? '').slice(0, TITLE_BRIEF_CHARS) }))
      .filter(x => x.key)
    if (target && items.length) appendInbox({ sessionId: target.id, kind: 'title', items })
  }
  // A batch of grades: one line each (the mod reads them one by one).
  if (a.kind === 'grades' && Array.isArray(a.items) && a.items.length) {
    const target = openTarget(a.sessionId)
    if (target) appendInbox(...a.items.slice(0, MAX_ITEMS).map(g => ({ sessionId: target.id, kind: 'grade', grade: g })))
  }
  // Done-lists can be for any agent (earlier ones too).
  if (a.kind === 'done') {
    const raw = Array.isArray(a.items) ? a.items : [a]
    const items = raw.slice(0, MAX_ITEMS)
      .map(x => ({ id: String(x?.id ?? ''), label: String(x?.label ?? '').slice(0, LABEL_CHARS), brief: String(x?.brief ?? '').slice(0, DONE_BRIEF_CHARS), result: String(x?.result ?? '').slice(0, DONE_RESULT_CHARS) }))
      .filter(x => x.id && x.result.trim())
    const target = openTarget(a.sessionId)
    if (target && items.length) appendInbox({ sessionId: target.id, kind: 'done', items })
  }
}
