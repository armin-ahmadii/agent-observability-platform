// T3 Code delegated tasks. Each runs as its own session; the parent gets a row
// for it (type 'delegated'), which the web page links to that session by title.

import { type $, BRIEF_CHARS, getRuns, patchRun } from './state'
import { addRun, newRun, route } from './runs'
import { threadIdIn } from './text'
import { mark } from './timeline'

const TITLE_CHARS = 80
/** Tells apart two tasks started in the same millisecond. */
let taskSeq = 0

/** Finished-task notices that T3 and Claude Code post as user messages; they aren't requests. */
export const NOTICE = /^(Delegated task node:|<task-notification>)/

type DelegateArgs = { title?: string; task?: string; target?: { model?: string; options?: Record<string, unknown> } }
type ToolOut = { text?: string; result?: unknown }

/** A delegate_task call by `parentId`: add the task's row, run the tool, and keep the child thread id it returns. */
export async function delegate<T extends ToolOut>($: $, parentId: string, args: DelegateArgs, run: () => Promise<T>): Promise<T> {
  const title = String(args.title ?? args.task ?? 'Delegated task').slice(0, TITLE_CHARS)
  const effort = args.target?.options?.effort ?? args.target?.options?.reasoningEffort
  const at = await $.clock.now()
  const task = newRun({
    id: `task:${at}-${++taskSeq}`,
    label: title,
    brief: String(args.task ?? '').slice(0, BRIEF_CHARS),
    type: 'delegated',
    model: args.target?.model,
    effort: effort == null ? undefined : String(effort),
    parentId,
    now: 'running',
    startedAt: at,
    costKnown: false,
  })
  await addRun($, task, `task:${title}`)
  await route($, { runId: task.id, label: title, model: task.model, kind: 'delegated' })
  $.ui.invalidate('ui.render')
  const out = await run()
  // Keep the child thread id so a later t3_thread_send finds this row.
  const said = `${out.text ?? ''} ${typeof out.result === 'string' ? out.result : JSON.stringify(out.result ?? '')}`
  const thread = threadIdIn(out.result) ?? threadIdIn(out.text) ?? /childThreadId\\?"?\s*[:=]\s*\\?"([^"\\\s]+)/.exec(said)?.[1]
  if (thread) await patchRun($, task.id, r => ({ ...r, childThreadId: thread }))
  return out
}

/** The row for a T3 thread: by its child thread id, else by title. */
export async function runForThread($: $, threadId: string) {
  const list = await getRuns($)
  return list.find(r => r.childThreadId && r.childThreadId === threadId) ?? list.find(r => r.type === 'delegated' && r.label === threadId)
}

/**
 * T3's notice that a helper's turn ended, e.g. "Delegated task node:<id> (Title) [completed]: …"
 * (also [failed], [cancelled], …; older builds wrote "(Title) finished").
 */
export const DONE_NOTICE = /^Delegated task node:\S*\s*\((.+?)\)\s*\[?(finished|completed|failed|errored|cancell?ed|stopped|interrupted)\]?/i
const OK_ENDINGS = /finished|completed/i

/** A done notice: the parent's own row for that task is done too. */
export async function noticeDone($: $, text: string) {
  const m = DONE_NOTICE.exec(text)
  if (!m?.[1]) return
  const title = m[1]
  const failed = !OK_ENDINGS.test(m[2] ?? '')
  const run = (await getRuns($)).find(r => r.type === 'delegated' && r.now !== 'done' && r.label === title)
  if (!run) return
  if (failed) await patchRun($, run.id, r => ({ ...r, attention: 'failed' }))
  await mark($, run.id, 'done')
}
