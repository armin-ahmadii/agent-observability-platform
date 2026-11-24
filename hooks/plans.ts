// Haiku turns a run's brief into 3-6 planned steps, once per run, for runs
// that keep no to-do list. The agent's own `progress` steps replace this guess.
import { askHaiku } from './haiku'
import { type $, TRIAGE, findRun, isHaikuOn, patchRun } from './state'
import { cleanAsk, jsonArrayIn, stepsFrom, stripContext } from './text'

/** Briefs shorter than this (once cleaned) are too thin to plan from. */
const MIN_BRIEF_CHARS = 20
const planning = new Set<string>()

export async function planRun($: $, id: string, brief: string) {
  if (!isHaikuOn() || cleanAsk(brief).length < MIN_BRIEF_CHARS || id === TRIAGE || planning.has(id)) return
  const run = await findRun($, id)
  if (!run || run.plan || run.tasks?.length) return
  planning.add(id)
  const label = run.label.slice(0, 40)
  try {
    const result = await askHaiku(
      $,
      { doing: `Planning "${label}"`, done: `Planned "${label}"` },
      {
        maxTokens: 150,
        system: 'You list the planned steps of an AI agent task for a dashboard. Reply with one JSON array of strings only.',
        prompt:
          `Task:\n${stripContext(brief).slice(0, 2500)}\n\n` +
          'Reply as ["<step>", ...] with 3 to 6 steps in order. Each step is imperative, plain, at most 6 words, e.g. "Read the existing hooks".',
      },
    )
    if (!result.isAnswered) return
    const steps = stepsFrom(jsonArrayIn(result.text) ?? [])
    if (steps.length < 2) return
    await patchRun($, id, r => (r.plan ? r : { ...r, plan: steps, planSource: 'guess' as const }))
  } catch {
    // no plan; the page shows nothing
  } finally {
    planning.delete(id)
  }
}
