// Rows on the dashboard: creating runs, cost and tokens from Claude Code's own
// ledger, where your requests were routed, and agents' to-do lists.

import type { Route, Run, TaskItem } from '../types'
import { planRun } from './plans'
import { type $, capRuns, BRIEF_CHARS, MAIN, TRIAGE, findRun, getRuns, isTracked, patchRun, updateRuns, updateAsks } from './state'
import { titleAgent } from './titles'

const MAIN_LABEL = 'Main conversation'
const LABEL_CHARS = 60
const MAX_ROUTES = 20
const MAX_TASKS = 40
const TASK_CHARS = 200
/** How long a prompt cache lives: one hour, or the default five minutes. */
const CACHE_1H_MS = 3_600_000
const CACHE_5M_MS = 300_000

/** A new run with nothing done yet. */
export function newRun(base: Pick<Run, 'id' | 'label' | 'brief' | 'type' | 'startedAt'> & Partial<Run>): Run {
  return { now: 'thinking', segments: [], mcp: {}, usd: 0, tokens: 0, ...base }
}

/** Queue a new run's short title and planned steps. */
function nameAndPlan($: $, run: Run, titleAs = run.id) {
  titleAgent($, titleAs, run.label, run.brief)
  void planRun($, run.id, run.brief)
}

/** Add a run at the top (replacing one with the same id) and queue its title and plan. */
export async function addRun($: $, run: Run, titleAs = run.id) {
  await updateRuns($, list => capRuns([run, ...list.filter(r => r.id !== run.id)]))
  nameAndPlan($, run, titleAs)
}

/**
 * Any agent the panel hasn't seen yet (a workflow agent, a fork, the main
 * conversation) gets a row the first time it does anything.
 */
export async function ensureRun($: $, id: string, text: string) {
  if (await isTracked($, id)) return
  const startedAt = await $.clock.now()
  const brief = text.slice(0, BRIEF_CHARS)
  if (id === MAIN) {
    const run = newRun({ id, label: MAIN_LABEL, brief, type: 'main', startedAt })
    await updateRuns($, list => (list.some(r => r.id === id) ? list : capRuns([...list, run])))
    return
  }
  const info = (await $.agent.list()).find(a => a.id === id)
  const run = newRun({
    id,
    label: info?.description || text.replace(/\s+/g, ' ').trim().slice(0, LABEL_CHARS) || 'Agent',
    brief,
    type: 'agent',
    model: info?.model,
    parentId: info?.parentId ?? MAIN,
    startedAt,
  })
  await updateRuns($, list => (list.some(r => r.id === id) ? list : capRuns([run, ...list])))
  nameAndPlan($, run)
}

function attentionOf(status: string | undefined, previous: Run['attention']): Run['attention'] {
  if (status === 'waiting') return 'waiting'
  if (status === 'failed') return 'failed'
  if (status === 'killed') return 'stopped'
  return previous === 'error' ? 'error' : undefined
}

type AgentInfo = Awaited<ReturnType<$['agent']['list']>>[number]
type SessionUsage = Awaited<ReturnType<$['session']['usage']>>

const sameContext = (a: Run['context'], b: Run['context']) => a === b || (!!a && !!b && a.used === b.used && a.window === b.window)

/** `next` when any field the usage refresh sets differs from `run`, else `run` itself (so an unchanged list keeps its identity). */
function keepIfSame(run: Run, next: Run): Run {
  const a = run.segments[run.segments.length - 1]
  const b = next.segments[next.segments.length - 1]
  const same =
    run.usd === next.usd &&
    run.tokens === next.tokens &&
    run.costKnown === next.costKnown &&
    run.model === next.model &&
    run.status === next.status &&
    run.attention === next.attention &&
    run.cacheUntil === next.cacheUntil &&
    run.effort === next.effort &&
    sameContext(run.context, next.context) &&
    (a === b || (!!a && !!b && a.end === b.end && a.tokens === b.tokens))
  return same ? run : next
}

/** The runs with Claude Code's latest usage applied; the same array when nothing changed. */
function withUsage(list: Run[], agents: AgentInfo[], usage: SessionUsage, at: number, onlyId?: string): Run[] {
  const sessionUsd = usage.cost?.usd
  const byId = new Map(agents.map(a => [a.id, a]))
  let changed = false
  const next = list.map(run => {
    if (onlyId && run.id !== onlyId) return run
    if (run.id === TRIAGE) return run
    let updated: Run
    if (run.id === MAIN) {
      // The main row is the session total minus every subagent this session ran
      // (finished ones too: agent.list drops those) and the background helper.
      const agentsUsd = list.reduce((n, r) => (r.id === MAIN || r.id === TRIAGE ? n : n + (byId.get(r.id)?.cost?.usd ?? r.usd ?? 0)), 0)
      const triageUsd = list.find(r => r.id === TRIAGE)?.usd ?? 0
      const context = usage.context?.tokens != null ? { used: usage.context.tokens, window: usage.context.window } : run.context
      updated = sessionUsd === undefined ? { ...run, context } : { ...run, context, usd: Math.max(0, sessionUsd - agentsUsd - triageUsd) }
    } else {
      const info = byId.get(run.id)
      if (!info) {
        if (run.costKnown !== undefined || run.tokens !== 0) return run
        updated = { ...run, costKnown: false }
      } else {
        const tokens = (info.usage ?? []).reduce((n, u) => n + u.input_tokens + u.output_tokens + u.cache_creation_input_tokens, 0)
        const total = tokens || run.tokens
        let segments = run.segments
        const last = segments[segments.length - 1]
        if (last && run.now !== 'done') {
          segments = [...segments]
          segments[segments.length - 1] = { ...last, end: at, tokens: Math.max(0, total - last.tokensAtStart) }
        }
        const request = info.lastRequest
        const effort = request?.effort ?? info.effort
        updated = {
          ...run,
          costKnown: info.cost !== undefined,
          usd: info.cost?.usd ?? run.usd,
          tokens: total,
          segments,
          model: request?.model ?? info.model ?? run.model,
          status: info.status,
          attention: attentionOf(info.status, run.attention),
          context: info.contextWindowSize ? { used: info.tokenCount, window: info.contextWindowSize } : run.context,
          cacheUntil: request?.cacheTtl ? request.at + (request.cacheTtl === '1h' ? CACHE_1H_MS : CACHE_5M_MS) : run.cacheUntil,
          effort: effort != null ? String(effort) : run.effort,
        }
      }
    }
    const kept = keepIfSame(run, updated)
    if (kept !== run) changed = true
    return kept
  })
  return changed ? next : list
}

/**
 * Copy cost, tokens, model, status and context from Claude Code onto every run
 * (or just `onlyId`). Writes state only when something changed. Returns the
 * session usage it read, so the 2s tick asks for it once.
 */
export async function refreshUsage($: $, onlyId?: string): Promise<SessionUsage> {
  const agents = await $.agent.list()
  const usage = await $.session.usage()
  const at = await $.clock.now()
  const list = await getRuns($)
  if (withUsage(list, agents, usage, at, onlyId) !== list) {
    await updateRuns($, current => withUsage(current, agents, usage, at, onlyId))
  }
  return usage
}

/** Add a route to your newest message while its main turn is still open. */
export async function route($: $, r: Route) {
  await updateAsks($, list => {
    const ask = list[0]
    if (!ask || ask.answeredAt !== undefined) return list
    if (ask.routedTo.some(x => x.runId === r.runId && x.kind === r.kind)) return list
    return [{ ...ask, routedTo: [...ask.routedTo, r].slice(-MAX_ROUTES) }, ...list.slice(1)]
  })
}

/** Mark your newest message answered. */
export async function answerAsk($: $, at: number) {
  await updateAsks($, list => (list[0] && list[0].answeredAt === undefined ? [{ ...list[0], answeredAt: at }, ...list.slice(1)] : list))
}

// ---------- to-do lists ----------

function taskStatus(status: unknown): TaskItem['status'] {
  return status === 'completed' ? 'done' : status === 'in_progress' ? 'in_progress' : 'pending'
}

const taskText = (v: unknown) => String(v ?? '').slice(0, TASK_CHARS)

async function setTasks($: $, id: string, next: (tasks: TaskItem[]) => TaskItem[]) {
  const at = await $.clock.now()
  await patchRun($, id, r => ({ ...r, tasks: next(r.tasks ?? []).slice(0, MAX_TASKS), tasksAt: at }))
}

export const TASK_TOOLS = /^(TodoWrite|TaskCreate|TaskUpdate|TaskList)$/

/** Store an agent's to-do tool call on its run. Runs after the tool answered. */
export async function recordTasks($: $, id: string, e: Record<string, unknown>, result: unknown) {
  const tool = String(e.tool)
  if (tool === 'TodoWrite' && Array.isArray(e.todos)) {
    const todos = e.todos as { content?: string; status?: string }[]
    await setTasks($, id, () => todos.map(t => ({ text: taskText(t.content), status: taskStatus(t.status) })))
  } else if (tool === 'TaskCreate') {
    const taskId = (result as { task?: { id?: string } } | undefined)?.task?.id
    const text = taskText(e.subject)
    await setTasks($, id, tasks => (taskId && tasks.some(t => t.id === taskId) ? tasks : [...tasks, { id: taskId, text, status: 'pending' }]))
  } else if (tool === 'TaskUpdate' && typeof e.taskId === 'string') {
    const taskId = e.taskId
    if (!(await findRun($, id))?.tasks?.some(t => t.id === taskId)) return
    await setTasks($, id, tasks =>
      e.status === 'deleted'
        ? tasks.filter(t => t.id !== taskId)
        : tasks.map(t =>
            t.id !== taskId
              ? t
              : { ...t, text: typeof e.subject === 'string' ? taskText(e.subject) : t.text, status: e.status ? taskStatus(e.status) : t.status },
          ),
    )
  } else if (tool === 'TaskList') {
    // The session's list is shared: only refresh items this agent created.
    const all = (result as { tasks?: { id: string; subject: string; status: string }[] } | undefined)?.tasks
    if (!Array.isArray(all)) return
    if (!(await findRun($, id))?.tasks?.some(t => t.id)) return
    const byId = new Map(all.map(t => [t.id, t]))
    await setTasks($, id, tasks =>
      tasks
        .filter(t => !t.id || byId.has(t.id))
        .map(t => {
          const fresh = t.id ? byId.get(t.id) : undefined
          return fresh ? { ...t, text: taskText(fresh.subject), status: taskStatus(fresh.status) } : t
        }),
    )
  }
}
