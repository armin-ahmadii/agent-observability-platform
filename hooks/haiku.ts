// The background helper: every Haiku job (naming, planning, grading...) goes
// through askHaiku, which shows the job on the helper's row while it runs and
// logs its tokens, cost and outcome there afterwards.

import type { Run } from '../types'
import { type $, TRIAGE, capRuns, getRuns, isHaikuOn, updateRuns } from './state'

const TRIAGE_MODEL = 'claude-haiku-5-5'
const TRIAGE_LABEL = 'Background helper'
// Claude Haiku 5.5 list prices, US$ per million tokens, for the row's cost estimate.
// Must match the claude-haiku-5-5 entry in live/lib/pricing.mjs so the page and the mod agree.
const HAIKU_PRICE = { input: 0.1, output: 0.5, cacheWrite5m: 0.125, cacheWrite1h: 0.2, cacheRead: 0.01 }
const PER_MTOK = 1_000_000
const HAIKU_TIMEOUT_MS = 30_000
const MAX_TRIAGE_SEGMENTS = 60
const MAX_TRIAGE_JOBS = 30
/** How wide a finished job is drawn on the timeline. */
const JOB_WIDTH_MS = 1000

type CompleteOptions = Parameters<$['model']['complete']>[0]
type CompleteResult = Awaited<ReturnType<$['model']['complete']>>

async function ensureTriageRow($: $) {
  if ((await getRuns($)).some(r => r.id === TRIAGE)) return
  const run: Run = {
    id: TRIAGE,
    label: TRIAGE_LABEL,
    brief: '',
    type: 'triage',
    model: TRIAGE_MODEL,
    now: 'thinking',
    startedAt: await $.clock.now(),
    segments: [],
    mcp: {},
    usd: 0,
    tokens: 0,
  }
  await updateRuns($, list => (list.some(r => r.id === TRIAGE) ? list : capRuns([run, ...list])))
}

/** The helper's row says what it is doing right now; null when idle. */
async function showDoing($: $, what: string | null) {
  await ensureTriageRow($)
  await updateRuns($, list =>
    list.map(run =>
      run.id !== TRIAGE
        ? run
        : { ...run, label: TRIAGE_LABEL, type: 'triage', model: TRIAGE_MODEL, now: what ? ('running' as const) : ('done' as const), doing: what ?? undefined },
    ),
  )
  $.ui.invalidate('ui.render')
}

async function logJob($: $, what: string, tokens: number, usd: number, ok: boolean) {
  await ensureTriageRow($)
  const at = await $.clock.now()
  await updateRuns($, list =>
    list.map(run =>
      run.id !== TRIAGE
        ? run
        : {
            ...run,
            label: TRIAGE_LABEL,
            type: 'triage',
            model: TRIAGE_MODEL,
            now: 'done' as const,
            doing: undefined,
            usd: run.usd + usd,
            tokens: run.tokens + tokens,
            segments: [
              ...run.segments,
              { key: 'running', act: 'running' as const, label: what, start: at - JOB_WIDTH_MS, end: at, tokensAtStart: run.tokens, tokens },
            ].slice(-MAX_TRIAGE_SEGMENTS),
            triageJobs: [...(run.triageJobs ?? []), { what: what.slice(0, 80), at, ok }].slice(-MAX_TRIAGE_JOBS),
          },
    ),
  )
}

/**
 * One Haiku call shown as a job on the background helper's row: `doing` while
 * it runs, then `done` with its tokens and cost. A call that throws (timeout,
 * network) is logged as failed under `doing` and rethrown.
 */
export async function askHaiku(
  $: $,
  job: { doing: string; done: string },
  opts: Omit<CompleteOptions, 'model' | 'timeoutMs'> & { timeoutMs?: number },
): Promise<CompleteResult> {
  // Callers check isHaikuOn first; this backstop makes no call, no row and logs
  // no failure (every caller already swallows a thrown job).
  if (!isHaikuOn()) throw new Error('The Haiku background helper is off (SUBAGENT_DECK_HAIKU)')
  await showDoing($, job.doing)
  let result: CompleteResult
  try {
    result = await $.model.complete({ model: TRIAGE_MODEL, timeoutMs: HAIKU_TIMEOUT_MS, ...opts })
  } catch (err) {
    await logJob($, job.doing, 0, 0, false).catch(() => {})
    throw err
  }
  const { tokens, usd } = costOf(result.usage)
  await logJob($, job.done, tokens, usd, result.isAnswered)
  return result
}

type Usage = {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  ephemeral_1h_input_tokens?: number
}

/** Tokens a call used and its cost, priced like live/lib/pricing.mjs (cache writes without a lifetime count as 5-minute). */
function costOf(usage: Usage | undefined): { tokens: number; usd: number } {
  const input = usage?.input_tokens ?? 0
  const output = usage?.output_tokens ?? 0
  const written = usage?.cache_creation_input_tokens ?? 0
  const read = usage?.cache_read_input_tokens ?? 0
  const written1h = Math.min(written, usage?.ephemeral_1h_input_tokens ?? 0)
  const p = HAIKU_PRICE
  const usd =
    (input * p.input + output * p.output + (written - written1h) * p.cacheWrite5m + written1h * p.cacheWrite1h + read * p.cacheRead) / PER_MTOK
  return { tokens: input + written + read + output, usd }
}
