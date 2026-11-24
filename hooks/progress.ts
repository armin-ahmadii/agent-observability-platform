// Live progress, reported by the agents themselves. Every session this mod
// loads in (T3 helpers' own sessions too) offers a small `progress` tool: an
// agent calls it with its steps, each step it starts and finishes, and a
// ≤5-word "what I'm doing now". No model calls.

import type { Run } from '../types'
import { ensureRun } from './runs'
import { type $, updateRuns } from './state'
import { clip } from './text'

const MAX_STEPS = 8

const PROGRESS_SPEC = {
  name: 'progress',
  description:
    "Report your progress to the owner's dashboard. Call at the start with your steps, then each time you start or finish a step, " +
    "and to say in 5 words or fewer what you're doing now. Steps are indexed from 0 in the order you gave them. Cheap; returns ok.",
  inputSchema: {
    type: 'object',
    properties: {
      steps: { type: 'array', items: { type: 'string' }, maxItems: MAX_STEPS, description: 'Your steps in order, each at most 6 words, imperative. Replaces the list; to add steps, send the whole list with the new ones at the end.' },
      done: { type: 'array', items: { type: 'integer' }, description: 'Indexes of steps now finished.' },
      current: { type: 'integer', description: 'Index of the step you are working on now.' },
      now: { type: 'string', description: "What you're doing right now, at most 5 words, e.g. \"Removing tooltips from Agents.tsx\"." },
    },
  },
  isDeferred: false,
}

/** The tool's full name as Claude Code registered it (set at session start). */
export let progressTool = `mcp__subagent-deck__${PROGRESS_SPEC.name}`

export async function registerProgressTool($: $) {
  progressTool = (await $.tool.register(PROGRESS_SPEC)).tool ?? progressTool
}

function applyProgress(r: Run, input: Record<string, unknown>, at: number): Run {
  const next: Run = { ...r }
  if (Array.isArray(input.steps)) {
    const steps = input.steps.filter(x => typeof x === 'string' && x.trim()).map(x => clip(x, 6, 60)).slice(0, MAX_STEPS)
    if (steps.length) {
      next.plan = steps
      next.planSource = 'agent'
      next.planDone = (r.planSource === 'agent' ? r.planDone ?? [] : []).filter(i => i < steps.length)
      if (next.planNow !== undefined && next.planNow >= steps.length) next.planNow = undefined
    }
  }
  const n = next.planSource === 'agent' ? next.plan?.length ?? 0 : 0
  const valid = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0 && (x as number) < n
  if (Array.isArray(input.done)) {
    next.planDone = [...new Set([...(next.planDone ?? []), ...input.done.filter(valid)])].sort((a, b) => a - b)
    if (next.planNow !== undefined && next.planDone.includes(next.planNow)) next.planNow = undefined
  }
  if (valid(input.current)) next.planNow = input.current
  if (typeof input.now === 'string' && input.now.trim()) {
    next.nowText = clip(input.now, 5, 60)
    next.nowAt = at
  }
  return next
}

/** Apply one `progress` call to run `id`; returns the tool's answer, e.g. "ok (2/5 done)". */
export async function reportProgress($: $, id: string, input: Record<string, unknown>): Promise<string> {
  await ensureRun($, id, '')
  const at = await $.clock.now()
  let said = ''
  await updateRuns($, list =>
    list.map(r => {
      if (r.id !== id) return r
      const next = applyProgress(r, input, at)
      const n = next.planSource === 'agent' ? next.plan?.length ?? 0 : 0
      said = `ok${n ? ` (${next.planDone?.length ?? 0}/${n} done)` : ''}`
      return next
    }),
  )
  $.ui.invalidate('ui.render')
  return said || 'ok'
}
