// Things the page asks the mod to make with Haiku: short titles, grades and "what it did" lists.
// Each agent is asked for at most once per page load, and only once the matching store has loaded.
import { deck } from '../data/store'
import { cleanMsg } from './format'
import { isMainRow, isRecent, plainName, titleKey, type TitleItem } from './agents'
import type { Run } from './types'

// The mod takes at most this many agents per request.
const BATCH = 60
function postInBatches(kind: string, items: unknown[]) {
  for (let i = 0; i < items.length; i += BATCH) deck.post({ kind, items: items.slice(i, i + BATCH) })
}

export function askTitles(list: TitleItem[]) {
  if (!deck.titles) return
  const items = []
  for (const r of list) {
    if (r.endedAt && !isRecent(r)) continue // agents that finished over a day ago keep their full names
    if (plainName(r) || r.short) continue
    const key = titleKey(r)
    if (!key || deck.titles[key] || deck.titlesAsked.has(key)) continue
    deck.titlesAsked.add(key)
    items.push({ key, label: cleanMsg(r.label), brief: (isMainRow(r) ? cleanMsg(r.label) : String(r.brief ?? '')).slice(0, 600) })
  }
  if (items.length) deck.post({ kind: 'title', items })
}

// What finished agents completed (shown as their checked list), for ones with a handed-back result.
export function askDone(list: Run[]) {
  if (!deck.done) return
  const items = []
  for (const r of list) {
    if (r.now !== 'done' || !isRecent(r) || !r.result || r.tasks?.length || r.done?.length || deck.done[r.id] || deck.doneAsked.has(r.id)) continue
    deck.doneAsked.add(r.id)
    items.push({ id: r.id, label: r.label ?? '', brief: String(r.brief ?? '').slice(0, 2000), result: String(r.result ?? '').slice(0, 3500) })
  }
  postInBatches('done', items)
}

type GradeItem = { id: string; result?: string; endedAt?: number; startedAt?: number; [k: string]: unknown }
// Grades for finished agents that handed something back.
export function askGrades(list: GradeItem[]) {
  if (!deck.grades) return
  const items = []
  for (const g of list) {
    if (!g.result || !isRecent(g) || deck.grades[g.id] || deck.gradesAsked.has(g.id)) continue
    deck.gradesAsked.add(g.id)
    items.push(g)
  }
  postInBatches('grades', items)
}
