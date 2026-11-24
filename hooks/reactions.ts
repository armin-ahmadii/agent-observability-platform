// Project memory: how you reacted to each agent's work. Haiku reads a message
// against the work that just finished: who it's about, praise (+) or
// frustration (-), and the lesson it implies. Saved to
// live/memory/<project>.json; scores add up per agent across the project.
//
// To keep it cheap, a free word check runs first: only messages that sound like
// praise or frustration are queued, and Haiku reads the queue in one call every
// RATE_BATCH_MS (or once BATCH_TRIGGER are waiting). Thumbs pressed on the page
// arrive one at a time through the inbox (rateFeedback).

import { askHaiku } from './haiku'
import { type $, MAIN, TRIAGE, isHaikuOn, readLiveJson, session, titleKey, writeLiveJson, getRuns } from './state'
import { jsonObjectIn, stripContext } from './text'

export const RATE_BATCH_MS = 30 * 60_000
const BATCH_TRIGGER = 8
const MAX_BATCH = 12
const MAX_CANDIDATES = 8
const MAX_EVENTS = 3000

type Candidate = { id: string; label: string; model?: string; kind: 'main' | 'subagent' | 'delegated'; result: string }
export type RateItem = { at: number; sessionId: string; project: string; text: string; candidates: Candidate[] }
type Reading = { reactions?: { agent?: number; score?: number }[]; quote?: string; lesson?: string | null }

const REACTION =
  /\b(great|love|loved|perfect|nice|awesome|amazing|excellent|good job|well done|fire|baller|incredible|beautiful|thank|thanks|wtf|wth|dude|terrible|awful|poor|wrong|broken|mess|messy|tired of|annoy\w*|frustrat\w*|ugh|hate|stupid|useless|crazy|lazy|sloppy|not working|doesn'?t work|still not|why the|what the|why (are|did|is|does|do|would) (you|this|it)|i lied|mistakes?)\b|!{2,}|\?{2,}/i

const SCORE_RULES =
  'score: 2 = clear praise (great, love it, perfect), 1 = mild approval, -1 = correction or annoyance, -2 = very frustrated (angry, swearing, "why are you", repeated mistakes). ' +
  'Only include agents the message is clearly about; a plain new request with no judgement of past work gives empty reactions. If unclear which agent, use the main one. ' +
  "lesson: what the user wants agents to do differently or keep doing, written as one imperative rule of 5 to 8 words (e.g. \"Reuse the file's existing components\"), only if the message implies one."

const ONE_RULES =
  'Reply as {"reactions": [{"agent": <index>, "score": -2..2}], "quote": "<the words that show it, max 12, verbatim>", "lesson": "<one rule for agents, 5-8 words, imperative, or null>"}.\n' +
  SCORE_RULES

const SYSTEM = "You read a user's message to their AI agents and judge how they reacted to the agents' work. Reply with one JSON object only."
const SYSTEM_BATCH = "You read a user's messages to their AI agents and judge how they reacted to the agents' work. Reply with one JSON object only."

const queue: RateItem[] = []

/** The work you're reacting to: the main conversation's last answer, plus every agent that finished since your previous message. */
async function candidatesNow($: $): Promise<Candidate[]> {
  const list = await getRuns($)
  const main = list.find(r => r.id === MAIN)
  const out: Candidate[] = []
  if (main && session.live) out.push({ id: `main:${session.live.id}`, label: 'Main conversation', model: main.model, kind: 'main', result: main.result ?? '' })
  for (const r of list) {
    if (r.id === MAIN || r.id === TRIAGE || r.now !== 'done') continue
    const ended = r.segments[r.segments.length - 1]?.end ?? r.startedAt
    if (ended < session.lastPromptAt) continue
    out.push({ id: titleKey(r), label: r.label, model: r.model, kind: r.type === 'delegated' ? 'delegated' : 'subagent', result: r.result ?? '' })
  }
  return out.slice(0, MAX_CANDIDATES)
}

/** A message you sent: queue it if it sounds like a reaction. Call before updating session.lastPromptAt. */
export async function noteMessage($: $, at: number, text: string) {
  if (!isHaikuOn() || !session.live || !REACTION.test(text)) return
  queue.push({ at, sessionId: session.live.id, project: session.live.project, text, candidates: await candidatesNow($) })
  if (queue.length >= BATCH_TRIGGER) void rateBatch($).catch(() => {})
}

/** Read one reaction now (a thumb pressed on the page). */
export async function rateFeedback($: $, item: RateItem) {
  const text = stripContext(item.text).trim()
  if (!isHaikuOn() || text.length < 3 || !item.candidates.length) return
  const about = item.candidates.length > 1 ? `${item.candidates.length} agents` : item.candidates[0]?.label ?? 'an agent'
  const list = item.candidates
    .map((c, i) => `[${i}] ${c.kind} "${c.label}"${c.model ? ` (${c.model})` : ''}. It just said: ${c.result.slice(0, 500).replace(/\s+/g, ' ')}`)
    .join('\n')
  const result = await askHaiku(
    $,
    { doing: `Reading your reaction to ${about}: "${text.slice(0, 40).replace(/\s+/g, ' ')}${text.length > 40 ? '…' : ''}"`, done: 'Read your reaction' },
    {
      maxTokens: 220,
      system: SYSTEM,
      prompt: `Agents whose work the user just saw:\n${list}\n\nThe user's message:\n<<<${text.slice(0, 2500)}>>>\n\n${ONE_RULES}`,
    },
  )
  if (!result.isAnswered) return
  let out: Reading
  try {
    out = jsonObjectIn<Reading>(result.text) ?? {}
  } catch {
    return
  }
  await saveReaction($, item, out)
}

/** Read every queued reaction in one call. */
export async function rateBatch($: $) {
  if (!isHaikuOn()) return
  const items = queue.splice(0, MAX_BATCH)
  if (!items.length) return
  const blocks = items.map((item, n) => {
    const agents = item.candidates
      .map((c, i) => `  [${i}] ${c.kind} "${c.label}"${c.model ? ` (${c.model})` : ''}: ${c.result.slice(0, 300).replace(/\s+/g, ' ')}`)
      .join('\n')
    return `Message ${n}:\nAgents whose work the user had just seen:\n${agents}\nThe user wrote: <<<${stripContext(item.text).trim().slice(0, 1500)}>>>`
  })
  const what = `${items.length} ${items.length === 1 ? 'reaction' : 'reactions'}`
  const result = await askHaiku(
    $,
    { doing: `Reading ${what} you left`, done: `Read ${what}` },
    {
      maxTokens: 120 + 160 * items.length,
      timeoutMs: 60_000,
      system: SYSTEM_BATCH,
      prompt:
        blocks.join('\n\n') +
        '\n\nReply as {"items": [{"message": <n>, "reactions": [{"agent": <index>, "score": -2..2}], "quote": "<max 12 words, verbatim>", "lesson": "<5-8 word imperative rule or null>"}]} with one entry per message.\n' +
        SCORE_RULES,
    },
  )
  if (!result.isAnswered) return
  let out: { items?: (Reading & { message?: number })[] }
  try {
    out = jsonObjectIn<typeof out>(result.text) ?? {}
  } catch {
    return
  }
  for (const o of out.items ?? []) {
    const item = items[Number(o.message)]
    if (item) await saveReaction($, item, o)
  }
}

async function saveReaction($: $, item: RateItem, out: Reading) {
  const reactions = (out.reactions ?? [])
    .map(r => ({ c: item.candidates[Number(r.agent)], score: Math.max(-2, Math.min(2, Math.round(Number(r.score) || 0))) }))
    .filter(r => r.c && r.score !== 0)
  const lesson = typeof out.lesson === 'string' && out.lesson.trim() && out.lesson !== 'null' ? out.lesson.trim().slice(0, 200) : null
  if (!reactions.length && !lesson) return
  const name = `memory/${item.project.replace(/[^\w.-]/g, '_')}.json`
  const mem = await readLiveJson<{ events: unknown[] }>($, name, { events: [] })
  mem.events = [
    ...(mem.events ?? []),
    {
      at: item.at,
      sessionId: item.sessionId,
      quote: String(out.quote ?? '').slice(0, 160),
      lesson,
      reactions: reactions.map(r => ({ id: r.c!.id, label: r.c!.label, model: r.c!.model, kind: r.c!.kind, score: r.score })),
    },
  ].slice(-MAX_EVENTS)
  await writeLiveJson($, name, mem, 1)
}
