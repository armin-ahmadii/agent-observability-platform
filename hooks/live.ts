// The link to the dashboard (served by live/server.mjs): this session's
// snapshot in live/sessions/<id>.json, and presses on the page, which arrive
// as lines in live/inbox.jsonl tagged with a session id.

import type { Run } from '../types'
import { queueDone } from './done-lists'
import { type GradeInput, gradeAgent } from './grades'
import { saveRun, toggleHelper } from './helpers'
import { type RateItem, rateFeedback } from './reactions'
import { registry } from './servers'
import { type $, type Live, getAsks, getHelpers, getRuns, liveDir, ownThreadId, readLiveJson, session, threadFile, updateAsks, writeLiveJson } from './state'
import { titleAgent } from './titles'

/** Most agents one page request may ask titles or done-lists for. */
const MAX_INBOX_ITEMS = 60

/**
 * Rewrite the session file at least this often even when nothing changed: the
 * server counts a session as open while its file is under 10s old
 * (LIVE_WITHIN_MS in live/lib/sessions.mjs).
 */
const HEARTBEAT_MS = 6000

let lastBody = ''
let lastWriteAt = 0
let lastUsage: SessionUsage | undefined
let writeQueued = false

type SessionUsage = Awaited<ReturnType<$['session']['usage']>>

/**
 * Write the session file right away rather than on the next tick: the page
 * shows your message, its routes and its answer as they happen. Calls in one
 * burst (a message and its first route) share one write.
 */
export function publishNow($: $) {
  if (writeQueued || !session.live) return
  writeQueued = true
  void Promise.resolve()
    .then(async () => {
      writeQueued = false
      const live = session.live
      if (live) await publish($, live, lastUsage ?? (await $.session.usage()))
    })
    .catch(() => {
      writeQueued = false
    })
}

/** In a T3 helper's own session: record which Claude session works in its thread, for the parent's routes. */
export async function recordOwnThread($: $, live: Live) {
  const thread = ownThreadId()
  if (thread) await writeLiveJson($, threadFile(thread), { threadId: thread, sessionId: live.id }, 0)
}

const childSessions = new Map<string, string>()

/** The Claude session working in a T3 helper thread, once it has started (see recordOwnThread). */
export async function childSessionOf($: $, threadId: string | undefined): Promise<string | undefined> {
  if (!threadId) return undefined
  const known = childSessions.get(threadId)
  if (known) return known
  // A miss costs one exists check (the file appears once the helper starts).
  const found = (await readLiveJson<{ sessionId?: unknown } | null>($, threadFile(threadId), null))?.sessionId
  if (typeof found !== 'string' || !found) return undefined
  childSessions.set(threadId, found)
  return found
}

/** How long after a message the tick keeps looking for a new helper's session. */
const CHILD_LOOKUP_MS = 10 * 60_000

/** Fill in `sessionId` on recent routes to T3 helpers whose session has started since. */
export async function fillRouteSessions($: $, now: number, runs: Run[]) {
  const asks = await getAsks($)
  const found = new Map<string, string>()
  for (const ask of asks) {
    if (now - ask.at > CHILD_LOOKUP_MS) continue
    for (const r of ask.routedTo) {
      if (r.sessionId || r.kind === 'subagent' || found.has(r.runId)) continue
      const sessionId = await childSessionOf($, runs.find(x => x.id === r.runId)?.childThreadId)
      if (sessionId) found.set(r.runId, sessionId)
    }
  }
  if (!found.size) return
  await updateAsks($, list =>
    list.map(a => ({ ...a, routedTo: a.routedTo.map(r => (!r.sessionId && found.has(r.runId) ? { ...r, sessionId: found.get(r.runId)! } : r)) })),
  )
}

/**
 * Write this session's snapshot to live/sessions/<id>.json, skipping the write
 * when nothing but the time changed since the last one (up to HEARTBEAT_MS).
 */
/** `known` passes the runs and time the caller already read (the 2s tick does). */
export async function publish($: $, live: Live, usage: SessionUsage, known?: { runs: Run[]; now: number }) {
  lastUsage = usage
  const list = known?.runs ?? (await getRuns($))
  const saved = await getHelpers($)
  const recent = await getAsks($)
  const now = known?.now ?? (await $.clock.now())
  const snapshot = {
    sessionId: live.id,
    project: live.project,
    updatedAt: 0, // set below, after the change check
    totalUsd: usage.cost?.usd ?? list.reduce((n, r) => n + r.usd, 0),
    // Your plan's usage windows (5-hour session, weekly), as Claude last reported them.
    rateLimits: usage.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt })),
    servers: registry,
    serverTokens: list.reduce<Record<string, number>>((acc, run) => {
      for (const seg of run.segments) if (seg.server) acc[seg.server] = (acc[seg.server] ?? 0) + seg.tokens
      return acc
    }, {}),
    runs: list,
    helpers: saved,
    // Your newest message and where it went; the last 5, newest first.
    lastAsk: recent[0] ?? null,
    recentAsks: recent,
    // In a T3 helper's own session: its T3 thread (the parent's run for it has this as childThreadId).
    ...(ownThreadId() ? { t3ThreadId: ownThreadId() } : {}),
  }
  const body = JSON.stringify(snapshot)
  if (body === lastBody && now - lastWriteAt < HEARTBEAT_MS) return
  // updatedAt is the third key, after two JSON strings, so this replaces only it.
  await $.fs.write(`${liveDir($)}/sessions/${live.id}.json`, body.replace('"updatedAt":0', `"updatedAt":${now}`))
  lastBody = body
  lastWriteAt = now
}

/** One agent the page wants a title ("title") or a done-list ("done") for. */
type InboxAgent = { key?: string; id?: string; label?: string; brief?: string; result?: string }
type InboxAction = { sessionId?: string; kind: string; id?: string; name?: string; grade?: GradeInput; item?: RateItem; items?: InboxAgent[] }

function parseLine(line: string): InboxAction | undefined {
  try {
    return JSON.parse(line) as InboxAction
  } catch {
    return undefined // a broken line is dropped
  }
}

/**
 * Take this session's lines out of the inbox; other sessions' lines stay.
 *
 * The server appends to inbox.jsonl at any moment, so the file is never
 * rewritten in place. Instead this session renames it to its own claim file
 * (an atomic move: the server's next append starts a fresh inbox.jsonl, and of
 * two sessions moving at once only one gets the file), reads the claim, appends
 * the other sessions' lines back to inbox.jsonl, and deletes the claim. A claim
 * left by an interrupted drain is finished first on the next tick.
 */
/** The inbox as last read and found to hold nothing for this session ("<mtime>:<size>"), so an unchanged file isn't read again. */
let seenInbox = ''
/** Whether a claim file may be left over (checked once per session start, and after a drain that didn't finish). */
let claimMayExist = true

async function takeMine($: $, live: Live): Promise<InboxAction[]> {
  const dir = liveDir($)
  const inbox = `${dir}/inbox.jsonl`
  const claim = `${dir}/inbox.${live.id.replace(/[^\w.-]/g, '_')}.claimed`
  try {
    if (!(claimMayExist && (await $.fs.exists(claim)))) {
      claimMayExist = false
      const stat = await $.fs.stat(inbox).catch(() => undefined)
      if (!stat) return []
      const seen = `${stat.mtimeMs}:${stat.size}`
      if (seen === seenInbox) return []
      const lines = (await $.fs.read(inbox)).split('\n').filter(Boolean)
      if (!lines.some(line => parseLine(line)?.sessionId === live.id)) {
        seenInbox = seen
        return []
      }
      claimMayExist = true
      const moved = await $.process.run(['mv', inbox, claim])
      if (moved.exitCode !== 0) return [] // another session took it first; ours come back next tick
    }
    const mine: InboxAction[] = []
    const rest: string[] = []
    for (const line of (await $.fs.read(claim)).split('\n').filter(Boolean)) {
      const action = parseLine(line)
      if (action?.sessionId === live.id) mine.push(action)
      else if (action) rest.push(line)
    }
    if (rest.length) {
      const back = await $.process.run(['sh', '-c', 'cat >> "$1"', 'sh', inbox], { stdin: rest.join('\n') + '\n' })
      if (back.exitCode !== 0) return [] // keep the claim; retried next tick
    }
    await $.process.run(['rm', '-f', claim])
    claimMayExist = false
    return mine
  } catch {
    return []
  }
}

export async function drainInbox($: $, live: Live) {
  for (const action of await takeMine($, live)) {
    if (action.kind === 'save' && action.id) await saveRun($, action.id)
    if (action.kind === 'toggle' && action.name) await toggleHelper($, action.name)
    if (action.kind === 'rate' && action.item && typeof action.item.text === 'string') {
      await rateFeedback($, action.item).catch(() => {})
    }
    if (action.kind === 'title' && Array.isArray(action.items)) {
      for (const a of action.items.slice(0, MAX_INBOX_ITEMS)) {
        if (a && typeof a.key === 'string' && a.key) titleAgent($, a.key, String(a.label ?? ''), String(a.brief ?? ''))
      }
    }
    if (action.kind === 'done' && Array.isArray(action.items)) {
      for (const a of action.items.slice(0, MAX_INBOX_ITEMS)) {
        if (a && typeof a.id === 'string' && a.id && typeof a.result === 'string') {
          queueDone($, { key: a.id, label: String(a.label ?? ''), brief: String(a.brief ?? ''), result: a.result })
        }
      }
    }
    if (action.kind === 'grade' && action.grade && typeof action.grade.result === 'string') {
      const g = action.grade
      void gradeAgent($, {
        id: String(g.id),
        label: String(g.label ?? ''),
        brief: String(g.brief ?? ''),
        result: String(g.result),
        usd: Number(g.usd) || 0,
        ms: Number(g.ms) || 0,
        errors: Number(g.errors) || 0,
      })
    }
  }
}
