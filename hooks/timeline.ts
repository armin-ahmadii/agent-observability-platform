// What an agent is doing, from the tools it calls, and its timeline of stretches.

import type { Activity, Run, Segment, ServerKind } from '../types'
import { VERB } from './icons'
import { registry, serverOf } from './servers'
import { type $, updateRuns } from './state'

/** Stretches kept per run. */
const MAX_SEGMENTS = 150

const RESEARCH = new Set(['Read', 'Grep', 'Glob', 'LS', 'WebSearch', 'WebFetch', 'ToolSearch'])
const BUILD = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
/** Handing work to other agents. */
const DELEGATE = new Set(['Agent', 'Task', 'SendMessage', 'TaskStop'])
const T3_DELEGATE = /delegate_task|t3_thread_(send|wait|launch)|task_(status|cancel)/
const READ_VERB = /(^|_)(get|find|list|read|search|screenshot|fetch|query|describe)/i

export function activityOf(tool: string): Activity {
  if (tool === 'AskUserQuestion' || tool === 'ExitPlanMode') return 'asking'
  if (DELEGATE.has(tool) || T3_DELEGATE.test(tool)) return 'delegating'
  if (RESEARCH.has(tool)) return 'researching'
  if (BUILD.has(tool)) return 'building'
  const server = serverOf(tool)
  if (server) {
    const action = tool.slice(tool.indexOf('__', 5) + 2)
    const reading = READ_VERB.test(action)
    const kind: ServerKind | undefined = registry[server]?.kind
    if (kind === 'research') return 'researching'
    if (kind === 'design') return reading ? 'checking' : 'designing'
    if (kind === 'build') return reading ? 'researching' : 'building'
    return reading ? 'researching' : 'running'
  }
  if (/html_(preview|render)|Artifact/.test(tool)) return 'designing'
  if (/screenshot|preview_(snapshot|status)/.test(tool)) return 'checking'
  return 'running'
}

/**
 * Record that run `id` is now doing `step`. Each MCP server (or built-in
 * activity) gets one stretch on the timeline; repeats extend it. Thinking
 * between actions gets a stretch of its own.
 *
 * Hooks on the hot path pass `at` (a time they already read) and `patch` (other
 * fields to set in the same write). Returns false when there is no run `id`.
 */
export async function mark(
  $: $,
  id: string,
  step: Activity,
  opts: { tool?: string; at?: number; patch?: (run: Run) => Partial<Run> } = {},
): Promise<boolean> {
  const at = opts.at ?? (await $.clock.now())
  const server = opts.tool ? serverOf(opts.tool) : undefined
  let found = false
  await updateRuns($, list => {
    if (!list.some(r => r.id === id)) return list
    found = true
    return list.map(run => {
      if (run.id !== id) return run
      const segments = [...run.segments]
      const last = segments[segments.length - 1]
      const closed = (seg: Segment): Segment => ({
        ...seg,
        end: at,
        tokens: Math.max(seg.tokens, run.tokens - seg.tokensAtStart),
      })
      if (last) segments[segments.length - 1] = closed(last)
      const key = server ? `${server}:${step}` : step
      if (step !== 'done' && last?.key !== key) {
        segments.push({ act: step, key, label: server ?? VERB[step], server, start: at, end: at, tokensAtStart: run.tokens, tokens: 0 })
      }
      return {
        ...run,
        ...opts.patch?.(run),
        segments: segments.slice(-MAX_SEGMENTS),
        now: step,
        nowServer: step === 'thinking' ? run.nowServer : server,
        mcp: server ? { ...run.mcp, [server]: (run.mcp[server] ?? 0) + 1 } : run.mcp,
      }
    })
  })
  return found
}
