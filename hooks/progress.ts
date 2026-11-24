// Live progress, reported by the agents themselves. Every session this mod
// loads in (T3 helpers' own sessions too) offers a small `progress` tool: an
// agent calls it with its steps, each step it starts and finishes, and a
// ≤5-word "what I'm doing now", and the owner's request (`ask`) the steps
// belong to (see asks.ts). No model calls.

import { MAX_STEPS, applyProgress } from './asks'
import { agentNamesOwnerAsk } from './owner-asks'
import { ensureRun } from './runs'
import { type $, MAIN, updateRuns } from './state'

const PROGRESS_SPEC = {
  name: 'progress',
  description:
    "Report your progress to the owner's dashboard. Call at the start with the owner's request (`ask`) and your steps, then each time you start or finish a step, " +
    "and to say in 5 words or fewer what you're doing now. Steps are indexed from 0 in the order you gave them and belong to the current ask. Cheap; returns ok.",
  inputSchema: {
    type: 'object',
    properties: {
      ask: { type: 'string', description: 'The owner\'s request this work is for, 5–7 words, in the owner\'s terms (e.g. "Add resolve button to failed rows"). Send it on your first call and whenever you start on a new request; leave it out otherwise.' },
      steps: { type: 'array', items: { type: 'string' }, maxItems: MAX_STEPS, description: 'Your steps for the current ask, in order, each at most 6 words, imperative. Replaces the list; to add steps, send the whole list with the new ones at the end.' },
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

/** Apply one `progress` call to run `id`; returns the tool's answer, e.g. "ok (2/5 done)". */
export async function reportProgress($: $, id: string, input: Record<string, unknown>): Promise<string> {
  await ensureRun($, id, '')
  const renameLatest = id === MAIN && agentNamesOwnerAsk(input.ask)
  const at = await $.clock.now()
  let said = ''
  await updateRuns($, list =>
    list.map(r => {
      if (r.id !== id) return r
      const next = applyProgress(r, input, at, r.label, renameLatest)
      const ask = next.asks?.[next.asks.length - 1]
      const n = ask?.steps.length ?? 0
      said = `ok${n ? ` (${ask!.done.length}/${n} done)` : ''}`
      return next
    }),
  )
  return said || 'ok'
}
