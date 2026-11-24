// Saved helpers: a finished run saved as a reusable agent definition, with a
// notebook of lasting facts it adds to after each job. Kept in the plugin store
// and registered with Claude Code as `subagent-deck:<name>`.

import type { Helper } from '../types'
import { type $, findRun, patchRun, getHelpers, updateHelpers } from './state'
import { slug } from './text'

/** Agent definitions this mod registers are named `${HELPER_PREFIX}<helper>`. */
export const HELPER_PREFIX = 'subagent-deck:'
const STORE_KEY = 'helpers-v1'
const NOTEBOOK = 'NOTEBOOK:'
const MAX_NOTES = 30

const NOTEBOOK_RULE = `When you finish, end your final answer with a line "${NOTEBOOK}" followed by up to 3 short "- " bullet points: lasting facts about this user or their projects that would help you next time (no task-specific details). Write "${NOTEBOOK} none" if there is nothing new.`

function promptOf(helper: Helper): string {
  const notes = helper.notes.length
    ? `\n\nYour notebook (what you learned on earlier jobs for this user):\n${helper.notes.map(n => `- ${n}`).join('\n')}`
    : ''
  return `You are "${helper.name}", a reusable helper the user saved because you did good work. You were first set up for this task, and you apply the same approach and standards to new tasks:\n\n${helper.brief}${notes}\n\n${NOTEBOOK_RULE}`
}

function descriptionOf(helper: Helper): string {
  const swarm = helper.swarm ? ` Part of the "${helper.swarm}" swarm: when the user asks for that swarm, use every helper in it.` : ''
  const first = helper.brief.replace(/\s+/g, ' ').slice(0, 140)
  return `Saved helper "${helper.name}". First used for: ${first}.${swarm} Spawn it with name "${helper.name}". If it already ran in this session, continue it with SendMessage to "${helper.name}" instead of spawning a new one.`
}

/** An answer without its notebook section: everything before the last NOTEBOOK: marker (the same one parseNotes reads). */
export function withoutNotebook(answer: string): string {
  const at = answer.lastIndexOf(NOTEBOOK)
  return at < 0 ? answer : answer.slice(0, at)
}

/** The "- " bullets after the answer's last NOTEBOOK: line (at most 3). */
function parseNotes(answer: string): string[] {
  const at = answer.lastIndexOf(NOTEBOOK)
  if (at < 0) return []
  return answer
    .slice(at + NOTEBOOK.length)
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('- '))
    .map(line => line.slice(2).trim())
    .filter(line => line.length > 0 && line.length < 300)
    .slice(0, 3)
}

export async function registerHelper($: $, helper: Helper) {
  try {
    await $.agent.register({
      name: helper.name,
      description: descriptionOf(helper),
      prompt: promptOf(helper),
      ...(helper.model ? { model: helper.model } : {}),
    })
  } catch {
    // The session may not have bound yet; the next session.start registers it.
  }
}

/** Load the saved helpers from the store and register each one. */
export async function loadHelpers($: $) {
  const stored = (await $.store.get(STORE_KEY)) as Helper[] | undefined
  if (Array.isArray(stored)) await updateHelpers($, () => stored)
  for (const helper of await getHelpers($)) await registerHelper($, helper)
}

export async function saveHelpers($: $, next: (list: Helper[]) => Helper[]) {
  await updateHelpers($, next)
  const list = await getHelpers($)
  await $.store.set(STORE_KEY, list)
  return list
}

/** "Save as helper" on a finished run. */
export async function saveRun($: $, id: string) {
  const run = await findRun($, id)
  if (!run || run.savedAs) return
  const taken = new Set((await getHelpers($)).map(h => h.name))
  let name = slug(run.label)
  for (let i = 2; taken.has(name); i++) name = `${slug(run.label)}-${i}`
  const helper: Helper = { name, brief: run.brief, model: run.model, isOn: true, notes: [], uses: 0 }
  await saveHelpers($, l => [...l, helper])
  await registerHelper($, helper)
  await patchRun($, id, r => ({ ...r, savedAs: name }))
  $.ui.toast(`Saved as "${name}". Rename it with /rename-helper.`)
}

export async function toggleHelper($: $, name: string) {
  await saveHelpers($, l => l.map(h => (h.name === name ? { ...h, isOn: !h.isOn } : h)))
}

export async function countUse($: $, name: string) {
  await saveHelpers($, list => list.map(h => (h.name === name ? { ...h, uses: h.uses + 1 } : h)))
}

/** Add new notebook lines from a helper's answer, and re-register it so the next spawn sees them. */
export async function learnFrom($: $, name: string, answer: string) {
  const notes = parseNotes(answer)
  if (!notes.length) return
  const list = await saveHelpers($, all =>
    all.map(h => (h.name === name ? { ...h, notes: [...h.notes, ...notes.filter(n => !h.notes.includes(n))].slice(-MAX_NOTES) } : h)),
  )
  const helper = list.find(h => h.name === name)
  if (helper) await registerHelper($, helper)
}
