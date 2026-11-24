// Getting rows back after Claude Code resets the mod's state.
//
// The engine keeps plugin state through a hot reload of the code, but not
// through a compaction (`/compact` or auto-compact) or a resumed session: the
// state comes back empty while this session file still holds every row. A
// reset is noticed by the runs state's version going backwards, or by the main
// row having been re-created; then:
//   1. rows, recent messages and saved helpers are merged back from the session
//      file and the plugin store (merged, never replaced: rows made since stay);
//   2. T3 helpers missing from both are rebuilt from the session's transcript
//      (transcript.ts), which outlives everything else.
import type { Run, RoutedAsk } from '../types'
import { MAX_ASKS } from './asks'
import { loadHelpers } from './helpers'
import {
  type $,
  type Live,
  MAIN,
  capRuns,
  findRun,
  getRuns,
  readLiveJson,
  runsVersion,
  updateAsks,
  updateRuns,
} from './state'
import { recoverDelegated } from './transcript'

const MAX_SEGMENTS = 150
const MAX_RECENT_ASKS = 5

let lastVersion = 0
let mainStartedAt: number | undefined

/** The earlier of two start times, ignoring 0 (unknown). */
function earliest(a: number, b: number): number {
  return a && b ? Math.min(a, b) : a || b
}

/** Merge two copies of one run: `older` from before the reset, `newer` made since. */
function mergeRun(older: Run, newer: Run): Run {
  const asks = [...(older.asks ?? []), ...(newer.asks ?? []).filter(a => !older.asks?.some(o => o.at === a.at && o.title === a.title))]
  const mcp = { ...older.mcp }
  for (const [k, n] of Object.entries(newer.mcp)) mcp[k] = (mcp[k] ?? 0) + n
  return {
    ...older,
    ...newer,
    label: older.label,
    brief: older.brief || newer.brief,
    short: newer.short ?? older.short,
    startedAt: earliest(older.startedAt, newer.startedAt),
    segments: [...older.segments, ...newer.segments].slice(-MAX_SEGMENTS),
    mcp,
    tokens: older.tokens + newer.tokens,
    usd: newer.id === MAIN ? newer.usd : older.usd + newer.usd, // the main row's cost is recomputed from the session total
    asks: asks.length ? asks.slice(-MAX_ASKS) : undefined,
    plan: newer.plan ?? older.plan,
    planSource: newer.plan ? newer.planSource : older.planSource,
    planDone: newer.plan ? newer.planDone : older.planDone,
    planNow: newer.plan ? newer.planNow : older.planNow,
    tasks: newer.tasks ?? older.tasks,
    result: newer.result ?? older.result,
    done: newer.done ?? older.done,
    triageJobs: older.triageJobs || newer.triageJobs ? [...(older.triageJobs ?? []), ...(newer.triageJobs ?? [])].slice(-30) : undefined,
  }
}

/**
 * The rows to keep after a reset: every saved row, merged with its copy made
 * since (if any), plus the rows made since that weren't saved, newest first,
 * the main row last.
 */
export function mergeRuns(saved: Run[], current: Run[]): Run[] {
  // The same row: same id, or the same T3 helper thread (its id may differ after a repair).
  const same = (a: Run, b: Run) => a.id === b.id || (a.type === 'delegated' && !!a.childThreadId && a.childThreadId === b.childThreadId)
  const merged = saved.map(r => {
    const twin = current.find(c => same(r, c))
    return twin ? mergeRun(r, twin) : r
  })
  const fresh = current.filter(r => !saved.some(s => same(s, r)))
  const all = [...fresh, ...merged]
  const main = all.find(r => r.id === MAIN)
  return capRuns(main ? [...all.filter(r => r !== main), main] : all)
}

/** Merge back what the session file holds, the saved helpers, and the transcript's T3 helpers. */
async function restore($: $, live: Live) {
  const saved = await readLiveJson<{ runs?: Run[]; recentAsks?: RoutedAsk[] } | null>($, `sessions/${live.id}.json`, null)
  if (saved?.runs?.length) {
    const fromFile = saved.runs.filter(r => r && typeof r.id === 'string')
    await updateRuns($, current => mergeRuns(fromFile, current))
  }
  if (saved?.recentAsks?.length) {
    const before = saved.recentAsks
    await updateAsks($, current => [...current, ...before.filter(a => !current.some(c => c.at === a.at))].sort((a, b) => b.at - a.at).slice(0, MAX_RECENT_ASKS))
  }
  await loadHelpers($)
  await recoverDelegated($)
}

/**
 * Restore if the state was reset since the last check. Cheap when nothing
 * happened: one version read and one row lookup.
 */
export async function restoreIfReset($: $, live: Live | null) {
  if (!live) return
  const version = await runsVersion($)
  const main = await findRun($, MAIN)
  if (version < lastVersion || (mainStartedAt !== undefined && (!main || main.startedAt > mainStartedAt))) {
    await restore($, live)
    await remember($)
    return
  }
  lastVersion = version
  mainStartedAt = main?.startedAt
}

/**
 * At session start (a new process, a resumed session, or a hot reload of this
 * code). After a hot reload the state is intact, so only missing T3 helpers are
 * added from the transcript (adding never counts anything twice); with an
 * empty state everything is merged back.
 */
export async function restoreAtStart($: $, live: Live) {
  if ((await getRuns($)).length === 0) await restore($, live)
  else await recoverDelegated($)
  await remember($)
}

async function remember($: $) {
  lastVersion = await runsVersion($)
  // No main row yet: its first appearance is not a reset.
  mainStartedAt = (await findRun($, MAIN))?.startedAt
}

/** When the transcript was last searched for a thread and nothing found. */
const threadMisses = new Map<string, number>()
/** A thread the transcript doesn't name (another session started it) isn't searched again for this long. */
const THREAD_RETRY_MS = 60_000

/** A follow-up names a T3 thread this session has no row for: look for it in the transcript. */
export async function reattachThread($: $, threadId: string) {
  if (!threadId || (await getRuns($)).some(r => r.childThreadId === threadId)) return
  const now = await $.clock.now()
  if (now - (threadMisses.get(threadId) ?? -Infinity) < THREAD_RETRY_MS) return
  await recoverDelegated($)
  if (!(await getRuns($)).some(r => r.childThreadId === threadId)) threadMisses.set(threadId, now)
}
