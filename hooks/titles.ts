// Short titles: Haiku turns an agent's description and brief into
// "Action: up to 3 words" (e.g. "Build: timeline lanes UI"), once per agent,
// kept in live/titles.json and on live runs as `short`. Keys: the agent id, or
// "task:<title>" for T3 tasks (see titleKey). Jobs run one after another.

import type { Run } from '../types'
import { askHaiku } from './haiku'
import { type $, MAIN, TRIAGE, isHaikuOn, readLiveJson, titleKey, writeLiveJson, updateRuns } from './state'
import { cleanAsk } from './text'

const TITLES_FILE = 'titles.json'
const ACTIONS = ['Build', 'Design', 'Research', 'Review', 'Fix', 'Plan', 'Write', 'Check', 'Sort', 'Grade']

type TitleJob = { key: string; label: string; brief: string; latest?: boolean }
const queue: TitleJob[] = []
const queued = new Set<string>()
let busy = false

/** "build: Timeline lanes UI." → "Build: Timeline lanes UI", or null when the reply doesn't fit. */
function cleanTitle(text: string): string | null {
  const m = /^\W*([A-Za-z]+)\s*:\s*(.+)$/.exec(text.trim().split('\n')[0] ?? '')
  const verb = ACTIONS.find(a => a.toLowerCase() === m?.[1]?.toLowerCase())
  if (!verb || !m?.[2]) return null
  const words = m[2].replace(/["“”.]+$/g, '').replace(/^["“]+/, '').trim().split(/\s+/).slice(0, 3).join(' ')
  return words ? `${verb}: ${words}`.slice(0, 48) : null
}

async function setShort($: $, key: string, short: string) {
  await updateRuns($, list => list.map(r => (titleKey(r) === key && r.short !== short ? { ...r, short } : r)))
}

/** Queue an agent for a title (once per key). */
export function titleAgent($: $, key: string, label: string, brief: string) {
  if (!isHaikuOn() || !key || key === MAIN || key === TRIAGE || queued.has(key)) return
  queued.add(key)
  queue.push({ key, label, brief })
  void drain($)
}

/** A follow-up to an existing run: name it again from its latest instruction. Keeps the old title if Haiku fails. */
export function followUp($: $, run: Run | undefined, message: string) {
  if (!isHaikuOn() || !run || run.id === TRIAGE || !cleanAsk(message)) return
  const key = titleKey(run)
  if (queue.some(j => j.key === key && j.latest)) return
  queue.push({ key, label: run.label, brief: message, latest: true })
  void drain($)
}

async function drain($: $) {
  if (busy) return
  busy = true
  try {
    for (let job = queue.shift(); job; job = queue.shift()) {
      try {
        const known = job.latest ? undefined : (await readLiveJson<Record<string, string>>($, TITLES_FILE, {}))[job.key]
        if (known) {
          await setShort($, job.key, known)
          continue
        }
        const result = await askHaiku(
          $,
          { doing: 'Naming an agent', done: 'Named an agent' },
          {
            maxTokens: 30,
            system: 'You write very short titles for AI agent runs on a dashboard. Reply with the title only.',
            prompt:
              `Agent description: ${job.label.slice(0, 200)}\n${job.latest ? 'Its latest instruction (name the run after this)' : 'Start of its brief'}: ${cleanAsk(job.brief.replace(/\s+/g, ' ')).slice(0, 600) || job.brief.slice(0, 600)}\n\n` +
              `Reply with one line: "<Action>: <up to 3 words>". Action is exactly one of ${ACTIONS.join(', ')}. ` +
              'The words name what it works on, plain and specific, e.g. "Build: timeline lanes UI", "Research: graph references", "Review: hover states", "Fix: tooltip overlap".',
          },
        )
        const short = result.isAnswered ? cleanTitle(result.text) : null
        if (!short) continue
        if (job.key !== MAIN) {
          const all = await readLiveJson<Record<string, string>>($, TITLES_FILE, {})
          all[job.key] = short
          await writeLiveJson($, TITLES_FILE, all, 1)
        }
        await setShort($, job.key, short)
      } catch {
        // asked again next time the page loads
      } finally {
        if (!job.latest) queued.delete(job.key)
      }
    }
  } finally {
    busy = false
  }
}
