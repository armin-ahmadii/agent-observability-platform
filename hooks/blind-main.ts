// A turn whose end this copy of the module can't hear. Claude Code tells a
// turn's end only to hooks that heard its start, so when the module is
// reloaded mid-turn (e.g. a helper editing this very mod) the new copy never
// hears turn.complete and the main row would stay "working" forever. After a
// reload we watch the main loop instead: no step or tool call for IDLE_MS
// means its turn is over.
import { MAIN, type $, findRun } from './state'
import { mainTurnEnded } from './owner-asks'
import { answerAsk } from './runs'
import { mark } from './timeline'

const IDLE_MS = 90_000

let isBlind = false
let lastSeenAt = 0

/** At session start: if the main row is mid-turn, we missed its start. */
export async function checkMainAfterReload($: $) {
  const main = await findRun($, MAIN)
  if (main && main.now !== 'done') {
    isBlind = true
    lastSeenAt = await $.clock.now()
  }
}

/** A new main turn started: this copy will hear its end. */
export function mainTurnStarted() {
  isBlind = false
}

/** The main loop did something (a step or a tool call). */
export function sawMain(at: number) {
  lastSeenAt = at
}

export async function settleBlindMain($: $) {
  if (!isBlind) return
  const at = await $.clock.now()
  if (at - lastSeenAt < IDLE_MS) return
  isBlind = false
  const main = await findRun($, MAIN)
  if (!main || main.now === 'done') return
  await mark($, MAIN, 'done')
  await mainTurnEnded($, at)
  await answerAsk($, at)
  $.ui.invalidate('ui.render')
}
