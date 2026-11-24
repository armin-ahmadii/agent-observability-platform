// Grading finished agents: Haiku reads what an agent was asked and what it
// answered and says whether it did great work; great ones are suggested as
// helpers worth saving. One grade per agent, kept in live/grades.json.
import { askHaiku } from './haiku'
import { type $, ANSWER_CHARS, isHaikuOn, readLiveJson, writeLiveJson } from './state'
import { jsonObjectIn } from './text'

const GRADES_FILE = 'grades.json'
const GRADES = ['great', 'good', 'weak'] as const

type Grade = (typeof GRADES)[number]
type GradeStore = Record<string, { grade: Grade; why: string; at: number }>
export type GradeInput = { id: string; label: string; brief: string; result: string; usd?: number; ms?: number; errors?: number }

const grading = new Set<string>()

export async function gradeAgent($: $, a: GradeInput) {
  if (!isHaikuOn() || !a.id || !a.result.trim() || grading.has(a.id)) return
  if ((await readLiveJson<GradeStore>($, GRADES_FILE, {}))[a.id]) return
  grading.add(a.id)
  try {
    const result = await askHaiku(
      $,
      { doing: `Grading "${a.label}"`, done: `Graded "${a.label}"` },
      {
        maxTokens: 120,
        system: 'You grade AI agent runs for a dashboard. Be strict: most runs are "good", few are "great". Reply with one JSON object only.',
        prompt:
          `Task given to the agent:\n${a.brief.slice(0, 2500)}\n\nAgent's final answer:\n${a.result.slice(0, ANSWER_CHARS)}\n\n` +
          `Stats: ${a.errors ?? 0} failed tool calls; cost $${(a.usd ?? 0).toFixed(2)}; ${Math.round((a.ms ?? 0) / 1000)}s.\n\n` +
          'Reply as {"grade": "great" | "good" | "weak", "why": "<max 10 plain words>"}. great = fully did exactly what was asked, verified its work, clear answer, no loose ends; weak = incomplete, wrong, or mostly asking questions back.',
      },
    )
    if (!result.isAnswered) return
    const g = jsonObjectIn<{ grade?: string; why?: string }>(result.text) ?? {}
    const grade = GRADES.find(x => x === g.grade)
    if (!grade) return
    const all = await readLiveJson<GradeStore>($, GRADES_FILE, {})
    all[a.id] = { grade, why: String(g.why ?? '').slice(0, 120), at: await $.clock.now() }
    await writeLiveJson($, GRADES_FILE, all, 2)
  } catch {
    // try again next time it's asked for
  } finally {
    grading.delete(a.id)
  }
}
