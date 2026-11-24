// Project memory. The mod writes reactions to memory/<project>.json; here they are added up per agent (praise
// moves it up, frustration down) and the lessons collected. Thumbs from the page are written here directly.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { appendInbox } from './inbox.mjs'
import { MEMORY_DIR } from './paths.mjs'
import { pastPrompts } from './prompts.mjs'
import { listSessions, openSessions } from './sessions.mjs'

const BACKFILLED_FILE = 'backfilled.json' // { [sessionId]: time of the last message queued for rating }
const MAX_EVENTS = 200

// Same file name rule as the mod.
const projectFileName = project => String(project ?? 'other').replace(/[^\w.-]/g, '_') + '.json'

export const EMPTY_MEMORY = { events: [], agents: [], lessons: [] }

// `project`: a project folder name, or "all" for every project.
// Re-read only when a memory file was added, removed or changed (stat is cheap; parsing every file is not).
const memoryCache = new Map() // project -> { sig, result }
export function readMemory(project) {
  let sig = ''
  try { for (const n of readdirSync(MEMORY_DIR).sort()) { const st = statSync(join(MEMORY_DIR, n)); sig += `${n}:${st.mtimeMs}:${st.size};` } } catch {}
  const hit = memoryCache.get(project)
  if (hit && hit.sig === sig) return hit.result
  const result = readMemoryNow(project)
  memoryCache.set(project, { sig, result })
  return result
}
function readMemoryNow(project) {
  let names = []
  try { names = readdirSync(MEMORY_DIR).filter(n => n.endsWith('.json') && n !== BACKFILLED_FILE) } catch {}
  if (project !== 'all') names = names.filter(n => n === projectFileName(project))
  const events = []
  for (const n of names) {
    try { events.push(...(JSON.parse(readFileSync(join(MEMORY_DIR, n), 'utf8')).events ?? []).map(e => ({ ...e, project: n.replace(/\.json$/, '') }))) } catch {}
  }
  events.sort((a, b) => b.at - a.at)
  const agents = new Map(), lessons = new Map()
  for (const e of events) {
    for (const r of e.reactions ?? []) {
      const a = agents.get(r.id) ?? agents.set(r.id, { id: r.id, label: r.label, model: r.model, kind: r.kind, score: 0, ups: 0, downs: 0, last: null }).get(r.id)
      a.score += r.score
      if (r.score > 0) a.ups++; else a.downs++
      a.model ??= r.model
      a.last ??= { at: e.at, quote: e.quote, score: r.score }
      if (e.source === 'thumb' && a.thumb === undefined) a.thumb = r.score
    }
    if (e.lesson) {
      const key = e.lesson.toLowerCase()
      const mood = (e.reactions ?? []).reduce((n, r) => n + r.score, 0)
      const l = lessons.get(key) ?? lessons.set(key, { text: e.lesson, count: 0, mood: 0, at: e.at }).get(key)
      l.count++
      l.mood += mood
    }
  }
  return {
    events: events.slice(0, MAX_EVENTS),
    agents: [...agents.values()].sort((a, b) => b.score - a.score || b.ups - a.ups),
    lessons: [...lessons.values()].sort((a, b) => b.count - a.count || b.at - a.at),
  }
}

// A thumb up/down on an agent: one vote per agent; the same thumb again removes it.
// Returns the vote now in place (1, -1 or 0), or null when the request is not valid.
export function recordVote(v) {
  const sess = listSessions().find(x => x.id === v.sessionId)
  const score = v.score > 0 ? 1 : v.score < 0 ? -1 : 0
  if (!sess || !v.id || !score) return null
  mkdirSync(MEMORY_DIR, { recursive: true })
  const path = join(MEMORY_DIR, projectFileName(sess.project))
  let mem = { events: [] }
  try { mem = JSON.parse(readFileSync(path, 'utf8')) } catch {}
  const old = mem.events.find(e => e.source === 'thumb' && e.reactions?.[0]?.id === v.id)
  mem.events = mem.events.filter(e => e !== old)
  const changed = !old || old.reactions[0].score !== score
  if (changed) {
    mem.events.push({ at: Date.now(), sessionId: sess.id, source: 'thumb', quote: score > 0 ? 'Thumbs up' : 'Thumbs down', lesson: null,
      reactions: [{ id: String(v.id), label: String(v.label ?? ''), model: v.model, kind: v.kind, score }] })
  }
  writeFileSync(path, JSON.stringify(mem, null, 1) + '\n')
  return changed ? score : 0
}

// Queues a session's past messages for the newest open session's mod to rate (each message once).
// Returns how many were queued.
export function backfill(id) {
  const all = listSessions()
  const [target] = openSessions(all)
  const me = all.find(s => s.id === id)
  if (!target || !me) return 0
  const donePath = join(MEMORY_DIR, BACKFILLED_FILE)
  let done = {}
  try { done = JSON.parse(readFileSync(donePath, 'utf8')) } catch {}
  const since = done[id] ?? 0
  const items = pastPrompts(id, all.filter(s => s.parentId === id)).filter(p => p.at > since)
  for (const p of items) appendInbox({ sessionId: target.id, kind: 'rate', item: { ...p, sessionId: id, project: me.project } })
  if (items.length) {
    done[id] = items[items.length - 1].at
    try { mkdirSync(MEMORY_DIR, { recursive: true }); writeFileSync(donePath, JSON.stringify(done, null, 1)) } catch {}
  }
  return items.length
}
