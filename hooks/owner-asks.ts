// In a session's main chat, each message the owner sends starts a new ask on
// the main run, titled with the message shortened to at most 7 words.
//
// The ask appears at once (first 7 words) for messages of 4+ words, and Haiku
// then renames it, or drops it when the message isn't a request ("ok", "thanks").
// With Haiku off, the first 7 words stand and shorter messages are skipped.
// If the agent names the request with `progress({ ask })` during that turn,
// its title wins: the message's ask is renamed, not doubled.
import type { Run } from '../types'
import { askTitle, dropLatestAsk, finishLatestAsk, renameLatestAsk, startAsk } from './asks'
import { askHaiku } from './haiku'
import { type $, MAIN, isHaikuOn, patchRun } from './state'
import { jsonObjectIn, stripContext } from './text'

/** Messages shorter than this (in words) don't get an ask until Haiku says they are a request. */
const MIN_WORDS = 4
/** Characters of the message Haiku reads. */
const MESSAGE_CHARS = 1500

/** The ask the owner's latest message started on the main run, while its turn lasts. */
let pending: { at: number; shown: boolean; agentNamed: boolean } | null = null

/**
 * The owner sent a message: start its ask on the main run now (4+ words), then
 * let Haiku name it in the background, off the prompt's path.
 */
export async function noteOwnerMessage($: $, raw: string, at: number) {
  const text = stripContext(raw).replace(/\s+/g, ' ').trim()
  if (!text) return
  const mine = { at, shown: false, agentNamed: false }
  pending = mine
  if (text.split(' ').length >= MIN_WORDS) {
    await patchRun($, MAIN, r => startAsk(r, askTitle(text), at))
    mine.shown = true
  }
  if (isHaikuOn()) void nameOwnerAsk($, text, mine)
}

async function nameOwnerAsk($: $, text: string, mine: { at: number; shown: boolean; agentNamed: boolean }) {
  let title: string | null
  try {
    const result = await askHaiku(
      $,
      { doing: 'Naming your request', done: 'Named your request' },
      {
        maxTokens: 40,
        system: 'You title what a user asked their AI agent to do, for a dashboard. Reply with one JSON object only.',
        prompt:
          `The user's message:\n<<<${text.slice(0, MESSAGE_CHARS)}>>>\n\n` +
          'Reply as {"title": "<the request in 5 to 7 plain words, imperative, in the user\'s terms>"} e.g. {"title": "Add resolve button to failed rows"}, ' +
          'or {"title": null} when the message is not a request for work (thanks, ok, nvm, a reaction, a yes/no answer).',
      },
    )
    if (!result.isAnswered) return
    const out = jsonObjectIn<{ title?: unknown }>(result.text)
    if (out?.title === null) title = null // not a request
    else if (askTitle(out?.title)) title = askTitle(out?.title)
    else return // an answer we can't use: keep the first-7-words title
  } catch {
    return // keep the first-7-words title
  }
  if (mine.agentNamed) return // the agent's own title wins
  if (title === null) {
    if (mine.shown) await patchRun($, MAIN, r => dropLatestAsk(r, mine.at))
    return
  }
  const named = title
  const isMine = (r: Run) => r.asks?.[r.asks.length - 1]?.at === mine.at
  await patchRun($, MAIN, r => (mine.shown ? (isMine(r) ? renameLatestAsk(r, named) : r) : startAsk(r, named, mine.at)))
  mine.shown = true
}

/**
 * The main run's agent called `progress` with `ask` (or without, when `ask` is empty).
 * Returns true when that should rename the ask the owner's message started this turn
 * rather than start another; from then on the message's own title is left alone.
 */
export function agentNamesOwnerAsk(ask: unknown): boolean {
  if (!askTitle(ask) || !pending || pending.agentNamed) return false
  pending.agentNamed = true
  return pending.shown
}

/** The main turn ended: its ask is finished, and the next message starts afresh. */
export async function mainTurnEnded($: $, at: number) {
  pending = null
  await patchRun($, MAIN, r => finishLatestAsk(r, at))
}
