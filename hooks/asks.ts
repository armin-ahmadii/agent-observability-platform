// The owner's requests ("asks") on a run, each with its own steps. Pure
// functions over a Run; live/codex-progress.mjs keeps a copy of these rules
// for Codex helpers, so change both together.
//
// The legacy fields plan / planSource / planDone / planNow mirror the latest
// ask, so a page that only knows `plan` keeps working.
import type { Ask, Run } from '../types'
import { clip } from './text'

export const MAX_ASKS = 20
export const MAX_STEPS = 8
const TITLE_WORDS = 7
const TITLE_CHARS = 60

/** An ask title: at most 7 words, one line; '' when there is nothing usable. */
export function askTitle(value: unknown): string {
  return typeof value === 'string' ? clip(value, TITLE_WORDS, TITLE_CHARS) : ''
}

/** Close an ask that is being left behind: finished when all its steps are done (or it had none). */
function closeIfDone(ask: Ask, at: number): Ask {
  if (ask.finishedAt !== undefined) return ask
  return ask.steps.every((_, i) => ask.done.includes(i)) ? { ...ask, finishedAt: at } : ask
}

/** Copy the latest ask onto the legacy plan fields. */
function mirror(run: Run, asks: Ask[]): Run {
  const latest = asks[asks.length - 1]
  const next: Run = { ...run, asks }
  if (!latest) return next
  if (latest.steps.length) {
    next.plan = latest.steps
    next.planSource = 'agent'
    next.planDone = latest.done
    next.planNow = latest.now
  } else if (run.planSource === 'agent') {
    // A new ask without steps yet: the agent-reported plan belonged to the previous one.
    next.plan = undefined
    next.planSource = undefined
    next.planDone = undefined
    next.planNow = undefined
  }
  return next
}

/** Start a new ask on `run` (closing the previous one if its steps are all done). */
export function startAsk(run: Run, title: string, at: number): Run {
  const asks = (run.asks ?? []).map((a, i, all) => (i === all.length - 1 ? closeIfDone(a, at) : a))
  return mirror(run, [...asks, { title, at, steps: [], done: [] }].slice(-MAX_ASKS))
}

/** Rename the latest ask (used when the agent names the request the owner's message started). */
export function renameLatestAsk(run: Run, title: string): Run {
  const asks = [...(run.asks ?? [])]
  const latest = asks[asks.length - 1]
  if (!latest || latest.title === title) return run
  asks[asks.length - 1] = { ...latest, title }
  return { ...run, asks }
}

/** Drop the latest ask (an owner's message that turned out not to be a request), if it has no steps. */
export function dropLatestAsk(run: Run, at: number): Run {
  const latest = run.asks?.[run.asks.length - 1]
  if (!latest || latest.at !== at || latest.steps.length) return run
  return mirror(run, run.asks!.slice(0, -1))
}

/** Mark the latest ask finished (the run finished). */
export function finishLatestAsk(run: Run, at: number): Run {
  const latest = run.asks?.[run.asks.length - 1]
  if (!latest || latest.finishedAt !== undefined) return run
  return { ...run, asks: [...run.asks!.slice(0, -1), { ...latest, finishedAt: at }] }
}

const hasSteps = (steps: unknown) => Array.isArray(steps) && steps.some(x => typeof x === 'string' && x.trim())

type ProgressInput = { ask?: unknown; steps?: unknown; done?: unknown; current?: unknown; now?: unknown }

/**
 * Apply one `progress` call. `ask` different from the latest ask's title starts
 * a new ask, unless `renameLatest` (the latest ask came from the owner's message
 * this turn and the agent hasn't named it yet), which renames it instead.
 * Steps sent before any ask exist go into one titled `fallbackTitle` (as do steps
 * already on the run's legacy plan); a "now" line alone doesn't start one.
 */
export function applyProgress(run: Run, input: ProgressInput, at: number, fallbackTitle: string, renameLatest = false): Run {
  const title = askTitle(input.ask)
  let next = run
  const latest = () => next.asks?.[next.asks.length - 1]
  if (title) {
    if (!latest()) next = startAsk(next, title, at)
    else if (latest()!.title !== title) next = renameLatest ? renameLatestAsk(next, title) : startAsk(next, title, at)
  }
  const hasUpdate = Array.isArray(input.steps) || Array.isArray(input.done) || input.current !== undefined || typeof input.now === 'string'
  if (!hasUpdate) return next
  if (!latest()) {
    if (next.planSource === 'agent' && next.plan?.length) {
      // Steps reported before asks existed (e.g. the mod was updated mid-run): they become the first ask.
      const seeded: Ask = { title: askTitle(fallbackTitle) || 'Current task', at, steps: next.plan, done: next.planDone ?? [] }
      if (next.planNow !== undefined) seeded.now = next.planNow
      next = { ...next, asks: [seeded] }
    } else if (hasSteps(input.steps)) {
      next = startAsk(next, askTitle(fallbackTitle) || 'Current task', at)
    } else {
      // Nothing to group yet: only the "now" line, on the run.
      return typeof input.now === 'string' && input.now.trim() ? { ...next, nowText: clip(input.now, 5, 60), nowAt: at } : next
    }
  }

  const asks = [...next.asks!]
  const ask: Ask = { ...asks[asks.length - 1]! }
  if (Array.isArray(input.steps)) {
    const steps = input.steps.filter(x => typeof x === 'string' && x.trim()).map(x => clip(x, 6, 60)).slice(0, MAX_STEPS)
    if (steps.length) {
      ask.steps = steps
      ask.done = ask.done.filter(i => i < steps.length)
      if (ask.now !== undefined && ask.now >= steps.length) ask.now = undefined
    }
  }
  const n = ask.steps.length
  const valid = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0 && (x as number) < n
  if (Array.isArray(input.done)) {
    ask.done = [...new Set([...ask.done, ...input.done.filter(valid)])].sort((a, b) => a - b)
    if (ask.now !== undefined && ask.done.includes(ask.now)) ask.now = undefined
  }
  if (valid(input.current)) ask.now = input.current
  if (typeof input.now === 'string' && input.now.trim()) {
    ask.nowText = clip(input.now, 5, 60)
    next = { ...next, nowText: ask.nowText, nowAt: at }
  }
  // Work resumed on an ask that was marked finished.
  if (ask.finishedAt !== undefined) delete ask.finishedAt
  asks[asks.length - 1] = ask
  return mirror(next, asks)
}
