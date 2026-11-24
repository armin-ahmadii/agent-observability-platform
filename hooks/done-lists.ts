// What a finished agent actually did: Haiku reads its brief and handed-back
// result and lists what the result says it completed (never what it says it
// didn't). Once per agent, saved to live/done.json; live runs carry it as
// `done`. Jobs run one after another.

import { askHaiku } from './haiku'
import { type $, ANSWER_CHARS, TRIAGE, isHaikuOn, readLiveJson, writeLiveJson, updateRuns } from './state'
import { jsonArrayIn, stepsFrom, stripContext } from './text'

const DONE_FILE = 'done.json'

type DoneStore = Record<string, { items: string[]; at: number }>
type DoneJob = { key: string; label: string; brief: string; result: string; runId?: string }

const queue: DoneJob[] = []
const queued = new Set<string>()
let busy = false

export function queueDone($: $, job: DoneJob) {
  if (!isHaikuOn() || !job.key || job.key === TRIAGE || !job.result.trim() || queued.has(job.key)) return
  queued.add(job.key)
  queue.push(job)
  void drain($)
}

async function setDone($: $, runId: string | undefined, items: string[]) {
  if (!runId) return
  await updateRuns($, list => list.map(r => (r.id === runId ? { ...r, done: items } : r)))
}

async function drain($: $) {
  if (busy) return
  busy = true
  try {
    for (let job = queue.shift(); job; job = queue.shift()) {
      let saved = false
      try {
        const known = (await readLiveJson<DoneStore>($, DONE_FILE, {}))[job.key]
        if (known) {
          saved = true
          await setDone($, job.runId, known.items)
          continue
        }
        const label = job.label.slice(0, 40)
        const result = await askHaiku(
          $,
          { doing: `Listing what "${label}" did`, done: `Listed what "${label}" did` },
          {
            maxTokens: 160,
            system: 'You list what an AI agent actually completed, for a dashboard checklist. Use only what its final answer says it did. Reply with one JSON array of strings only.',
            prompt:
              `Task given to the agent:\n${stripContext(job.brief).slice(0, 2500)}\n\n` +
              `Agent's final answer:\n${job.result.slice(0, ANSWER_CHARS)}\n\n` +
              'Reply as ["<item>", ...] with 3 to 6 items it completed, in order. Each item is imperative (not past tense), plain, at most 6 words, e.g. "Swap approved afters into flows". ' +
              'Never invent items. Leave out anything the answer says was not done, skipped, failed or left for later. If it says it completed nothing, reply [].',
          },
        )
        if (!result.isAnswered) continue
        const parsed = jsonArrayIn(result.text)
        if (!parsed) continue
        const all = await readLiveJson<DoneStore>($, DONE_FILE, {})
        if (!all[job.key]) {
          all[job.key] = { items: stepsFrom(parsed), at: await $.clock.now() }
          await writeLiveJson($, DONE_FILE, all, 1)
        }
        saved = true
        await setDone($, job.runId, all[job.key]!.items)
      } catch {
        // asked again the next time the page sends it
      } finally {
        if (!saved) queued.delete(job.key)
      }
    }
  } finally {
    busy = false
  }
}
