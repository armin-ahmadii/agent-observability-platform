// Shared state for every module: the three atoms, the run ids with special
// meaning, size limits, and reading/writing the JSON stores in live/.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Ask, Helper, Run } from '../types'
import { liveDirFor } from './live-dir'

export type $ = EngineInterface

/** The main conversation's run id. */
export const MAIN = 'main'
/** The background helper's run id (every Haiku job is logged on this row). */
export const TRIAGE = 'triage'

/** Most runs kept per session (newest first; the main conversation sits last). */
const MAX_RUNS = 40
/** Characters of an agent's brief kept on its run. */
export const BRIEF_CHARS = 4000
/** Characters of a handed-back answer kept on its run as `result`. */
export const RESULT_CHARS = 600
/** Characters of a handed-back answer sent to Haiku. */
export const ANSWER_CHARS = 3500

// Claude Code's scan only accepts state reads and writes in the file that
// defines the atom, so every other module goes through the functions below.
const runs = atom({ plugin: 'subagent-deck', key: 'runs' } as const, [] as Run[], { shape: 'runs-2' })
const helpers = atom({ plugin: 'subagent-deck', key: 'helpers' } as const, [] as Helper[], { shape: 'helpers-1' })
/** Your last few messages and where each was routed (newest first). */
const asks = atom({ plugin: 'subagent-deck', key: 'asks' } as const, [] as Ask[], { shape: 'asks-1' })

export function getRuns($: $) {
  return read($, runs)
}
export function updateRuns($: $, change: (list: Run[]) => Run[]) {
  return update($, runs, change)
}
export function getHelpers($: $) {
  return read($, helpers)
}
export function updateHelpers($: $, change: (list: Helper[]) => Helper[]) {
  return update($, helpers, change)
}
export function getAsks($: $) {
  return read($, asks)
}
export function updateAsks($: $, change: (list: Ask[]) => Ask[]) {
  return update($, asks, change)
}

/** The session this copy of the module publishes as. */
export type Live = { id: string; project: string }

export const session: { live: Live | null; lastPromptAt: number } = { live: null, lastPromptAt: 0 }

export async function findRun($: $, id: string): Promise<Run | undefined> {
  return (await getRuns($)).find(r => r.id === id)
}

export async function isTracked($: $, id: string | undefined): Promise<boolean> {
  return id ? (await findRun($, id)) !== undefined : false
}

export async function patchRun($: $, id: string, change: (run: Run) => Run) {
  await updateRuns($, list => list.map(r => (r.id === id ? change(r) : r)))
}

/**
 * Keep at most MAX_RUNS rows by dropping the oldest agents. The main
 * conversation and the background helper are never dropped: losing them would
 * make ensureRun re-create the row (and its history) on the next tool call.
 */
export function capRuns(list: Run[]): Run[] {
  let excess = list.length - MAX_RUNS
  if (excess <= 0) return list
  const out = [...list]
  for (let i = out.length - 1; i >= 0 && excess > 0; i--) {
    const id = out[i]!.id
    if (id === MAIN || id === TRIAGE) continue
    out.splice(i, 1)
    excess--
  }
  return out
}

/** Delegated T3 tasks are keyed by title (their run id changes per session); everything else by run id. */
export function titleKey(run: Run): string {
  return run.type === 'delegated' ? `task:${run.label}` : run.id
}

let resolvedLiveDir: string | undefined
let haikuOn = true

/** SUBAGENT_DECK_HAIKU=off (or 0, false, no; any case) turns the Haiku background helper off. */
export function haikuSwitch(value: string | undefined): boolean {
  return !/^(off|0|false|no)$/i.test(value?.trim() ?? '')
}

/**
 * Read the mod's settings once per session start: the shared live/ folder
 * (see liveDirFor) and whether the Haiku background helper may run.
 * Variable names must be literals for Claude Code's scan.
 */
export async function readSettings($: $) {
  let override: string | undefined
  let home: string | undefined
  let haiku: string | undefined
  try {
    override = await $.env.get('SUBAGENT_DECK_LIVE') // the server reads the same variable
    home = await $.env.get('HOME')
    haiku = await $.env.get('SUBAGENT_DECK_HAIKU')
  } catch {
    // no environment to read: the plugin's own folder, Haiku on
  }
  resolvedLiveDir = liveDirFor($.plugin.root, override, home)
  haikuOn = haikuSwitch(haiku)
}

/** Whether the Haiku background helper may run (titles, plans, done-lists, grades, reactions, server sorting). */
export function isHaikuOn(): boolean {
  return haikuOn
}

/** The shared live/ folder (see liveDirFor). */
export function liveDir($: $): string {
  return resolvedLiveDir ?? liveDirFor($.plugin.root)
}

/** Read live/<name>; `fallback` when it is missing or broken. */
export async function readLiveJson<T>($: $, name: string, fallback: T): Promise<T> {
  try {
    const path = `${liveDir($)}/${name}`
    return (await $.fs.exists(path)) ? (JSON.parse(await $.fs.read(path)) as T) : fallback
  } catch {
    return fallback
  }
}

export async function writeLiveJson($: $, name: string, value: unknown, indent: number) {
  await $.fs.write(`${liveDir($)}/${name}`, JSON.stringify(value, null, indent) + '\n')
}
