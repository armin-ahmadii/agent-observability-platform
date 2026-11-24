// Small rules about one agent: its state, name, ids, steps and checklist. Shared by every area that shows agents.
import { deck } from '../data/store'
import type { Run } from './types'
import { cleanMsg, DAY } from './format'
import { localId } from './ids'

// Kinds of work, in lane order. Each has a colour token (--a-<act>) and an icon of the same name.
export const ACTS = ['thinking', 'designing', 'checking', 'researching', 'building', 'running', 'delegating', 'asking'] as const
export const VERB: Record<string, string> = { thinking: 'Thinking', researching: 'Researching', designing: 'Designing', checking: 'Checking', building: 'Building', running: 'Commands', delegating: 'Handing off', asking: 'Waiting on you' }
export const ATTN: Record<string, string> = { waiting: 'Waiting for you', failed: 'Failed', stopped: 'Stopped', error: 'Hit an error' }
// Attention states that mean it ended without finishing: its open checklist items show as failed.
export const ENDED_BADLY = ['failed', 'stopped', 'error']
export const needsYou = (r: Run) => !!ATTN[r.attention ?? '']
// A finished agent that stopped, failed or errored: you can mark it resolved.
export const canResolve = (r: Run) => r.now === 'done' && ENDED_BADLY.includes(r.attention ?? '')
// The session and run id the server knows a row by (All sessions prefixes ids with "<session>:").
export const runRef = (r: Run) => ({ sessionId: r.sessionOf ?? deck.snap?.sessionId ?? '', runId: localId(r) })

// Words the mod uses for an activity state. They are never shown as "what it is doing".
const STATE_WORDS = new Set<string>([...ACTS, 'done', 'pending', 'working', 'idle'])
export const isStateWord = (w: string) => STATE_WORDS.has(w)

type Named = { id: string; label?: string; kind?: string; type?: string; sessionOf?: string; short?: string }
export const isMainRow = (r: Named) => r.id === 'main' || String(r.id).endsWith(':main') || String(r.id).startsWith('main:') || r.kind === 'main'

// Queued: it exists but hasn't started working yet. A mod run still "pending", a T3 task whose session isn't there
// or hasn't done anything, or any run not done with no activity and no tokens yet. Main conversations and projects never queue.
export const isQueued = (r: Run) => {
  if (r.now === 'done' || isMainRow(r) || r.type === 'project' || r.type === 'triage') return false
  if (r.status === 'pending') return true
  if (r.type === 'delegated') return !r.session || !!r.queued
  return !(r.segments ?? []).some(s => s.end > s.start) && !r.tokens
}
export const isWorking = (r: Run) => r.now !== 'done' && !isQueued(r)

// What the agent says it is doing (or last did), in a few words, from the mod's `progress` tool.
// The words are in `nowText`, or in `now` when it isn't a state word.
export function liveNow(r: Run): string {
  if (isQueued(r)) return ''
  const t = typeof r.nowText === 'string' ? r.nowText : typeof r.now === 'string' && !isStateWord(r.now) ? r.now : ''
  return t.replace(/\s+/g, ' ').trim()
}

// The end of its last stretch of work (or its start, if it has none).
export const lastActivity = (r: Run) => Math.max(r.startedAt ?? 0, ...(r.segments ?? []).map(s => s.end))
export const finishedAt = (r: Run) => Number(r.endedAt) || Math.max(Number(r.startedAt) || 0, ...(r.segments ?? []).map(s => s.end))
// Finished in the last day. Older agents are not sent to the mod for titles, grades or done lists (each costs a Haiku call).
export const isRecent = (r: { endedAt?: number; startedAt?: number }) => Date.now() - (Number(r.endedAt) || Number(r.startedAt) || 0) < DAY

// A subagent with no effort of its own runs at the main conversation's.
export const effortOf = (r: Run) => r.effort ?? (r.past || r.type === 'triage' ? null : (deck.snap?.runs ?? []).find(x => x.id === 'main')?.effort)
export const ctxPct = (r: Run) => r.context && r.context.window > 0 ? Math.round(r.context.used / r.context.window * 100) : null

// A main conversation's to-do list or reported steps count only when they changed after your latest message;
// older ones belong to an earlier request.
const lastAskAt = (r: Run) => Number(r.lastAskAt ?? (deck.snap?.sessionId !== 'all' ? deck.snap?.lastAsk?.at : 0)) || 0
const freshTasks = (r: Run) => !isMainRow(r) || (Number(r.tasksAt) || 0) > lastAskAt(r)
const freshPlan = (r: Run) => !isMainRow(r) || (Number(r.nowAt) || 0) > lastAskAt(r)

// Steps for the row's ring: its own to-do list, else the steps it reported with the progress tool (never Haiku's guess).
export function stepsOf(r: Run): { x: number; y: number } | null {
  if (r.tasks?.length && !freshTasks(r)) return r.planSource === 'agent' && r.plan?.length && freshPlan(r) ? stepsOf({ ...r, tasks: [] }) : null
  if (r.planSource === 'agent' && r.plan?.length && !freshPlan(r)) return r.tasks?.length ? stepsOf({ ...r, planSource: undefined }) : null
  if (r.tasks?.length) return { x: r.tasks.filter(t => t.status === 'done').length, y: r.tasks.length }
  if (r.planSource === 'agent' && r.plan?.length) {
    const y = r.plan.length
    return { x: new Set((r.planDone ?? []).filter(i => i >= 0 && i < y)).size, y }
  }
  return null
}

// What an opened agent's list shows, in this order: its real to-do list, else what it finished (done agents),
// else the steps it is expected to take (never for main conversations, where the guess can be wrong), else nothing.
// A finished agent's plan shows only if the agent reported it itself: Haiku's guessed steps never tick, so after the
// agent finished they would only look undone.
export type AgentList = { kind: 'tasks'; items: NonNullable<Run['tasks']> } | { kind: 'done' | 'plan'; items: string[] }
  | { kind: 'jobs'; items: NonNullable<Run['triageJobs']> } | null
export function listOf(r: Run): AgentList {
  // The background helper: the jobs it has done, newest first.
  if (r.type === 'triage' || r.id === 'triage') return r.triageJobs?.length ? { kind: 'jobs', items: [...r.triageJobs].reverse() } : null
  // A main conversation: only steps from its current request (see freshTasks), never an old finished list.
  if (isMainRow(r)) {
    if (r.tasks?.length && freshTasks(r)) return { kind: 'tasks', items: r.tasks }
    if (r.planSource === 'agent' && r.plan?.length && freshPlan(r)) return { kind: 'plan', items: r.plan }
    return null
  }
  if (r.tasks?.length) return { kind: 'tasks', items: r.tasks }
  const saved = deck.done?.[r.id] ?? deck.done?.[titleKey(r)]
  const done = r.done?.length ? r.done : Array.isArray(saved) ? saved : saved?.items
  if (r.now === 'done' && done?.length) return { kind: 'done', items: done }
  if (r.plan?.length && (r.now !== 'done' || r.planSource === 'agent')) return { kind: 'plan', items: r.plan }
  return null
}

// The key the mod keeps an agent's short title under.
export const titleKey = (r: Named) => {
  if (isMainRow(r) && !String(r.id).startsWith('main:')) return `main:${r.sessionOf ?? deck.snap?.sessionId ?? ''}`
  if (r.kind === 'delegated') return String(r.id) // project memory already keys T3 tasks as "task:<title>"
  if (r.type === 'delegated') return `task:${r.label}`
  return localId(r)
}
// Main conversations, projects and the background helper keep their own name as plain text; agents get a
// two-tone short title ("Build: timeline lanes UI") from the mod.
export const plainName = (r: Named) => r.type === 'project' || r.type === 'triage' || isMainRow(r)
export const shortOf = (r: Named): string => plainName(r) ? cleanMsg(r.label) : r.short || deck.titles?.[titleKey(r)] || cleanMsg(r.label)
export type TitleItem = Named & { brief?: string; endedAt?: number; startedAt?: number }

// The id the project memory knows an agent by.
export function memId(r: Run) {
  const sid = r.sessionOf ?? deck.snap?.sessionId ?? ''
  const raw = localId(r)
  if (raw === 'main') return { id: `main:${sid}`, kind: 'main', sid }
  if (r.type === 'delegated') return { id: `task:${r.label}`, kind: 'delegated', sid }
  return { id: raw, kind: 'subagent', sid }
}
