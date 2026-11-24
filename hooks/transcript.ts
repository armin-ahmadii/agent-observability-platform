// T3 helpers this session started, read back from its transcript: each
// delegate_task call, the child thread id in its result, T3's done notices and
// later follow-ups. The transcript outlives the mod's state and session file,
// so this is the last resort after a reset (see restore.ts).
import type { Run } from '../types'
import { type $, BRIEF_CHARS, MAIN, capRuns, updateRuns } from './state'
import { DONE_NOTICE } from './t3'
import { threadIdIn } from './text'

const TITLE_CHARS = 80

/**
 * The transcript can be ~100 MB, and a command's output is cut at 4 MiB, so the
 * shell keeps only the lines that matter: delegate_task and t3_thread_send calls,
 * their results naming a child thread, and T3's notices; not the request copies
 * ("api-request-blob" lines repeat the whole conversation); and, if still large,
 * the newest part (the first line it cuts into fails to parse and is skipped).
 */
const TRANSCRIPT_GREP =
  'grep -F -e \'_delegate_task"\' -e \'__t3_thread_send"\' -e \'\\"childThreadId\\":\\"thread:\' -e \'"content":"Delegated task node:\' "$1"' +
  ' | grep -F -v \'"type":"api-request-blob"\' | tail -c 3500000'
type Entry = { type?: string; timestamp?: string; message?: { content?: unknown } }
type Block = { type?: string; id?: string; name?: string; input?: Record<string, unknown>; tool_use_id?: string; content?: unknown; text?: string }

/**
 * The T3 helpers this session started, from its transcript lines that mention
 * delegate_task, a childThreadId or a "finished" notice. Each becomes a
 * delegated row like the one delegate() makes; one whose notice says it ended
 * is done.
 */
export function delegatedFromTranscript(lines: string[]): Run[] {
  const started = new Map<string, Run>() // by tool_use id
  /** By title: whether its last notice says it failed; absent while it works (or was sent a follow-up since). */
  const ended = new Map<string, boolean>()
  const noteNotice = (text: string) => {
    const m = DONE_NOTICE.exec(text.trim())
    if (m?.[1]) ended.set(m[1], !/finished|completed/i.test(m[2] ?? ''))
  }
  for (const line of lines) {
    let entry: Entry
    try {
      entry = JSON.parse(line) as Entry
    } catch {
      continue
    }
    if (entry.type !== 'user' && entry.type !== 'assistant') continue
    const content = entry.message?.content
    const at = Date.parse(entry.timestamp ?? '') || 0
    if (typeof content === 'string') {
      noteNotice(content)
      continue
    }
    if (!Array.isArray(content)) continue
    for (const block of content as Block[]) {
      if (block.type === 'text' && typeof block.text === 'string') noteNotice(block.text)
      if (block.type !== 'tool_use' || !block.id) {
        if (block.type === 'tool_result' && block.tool_use_id && started.has(block.tool_use_id)) {
          const thread = threadIdIn(block.content)
          if (thread) started.get(block.tool_use_id)!.childThreadId = thread
        }
        continue
      }
      const input = block.input ?? {}
      if (/t3_thread_send$/.test(String(block.name))) {
        // A follow-up: that helper is at work again until its next notice.
        const run = [...started.values()].find(r => r.childThreadId && r.childThreadId === input.threadId)
        if (run) ended.delete(run.label)
      }
      if (!/delegate_task$/.test(String(block.name)) || started.has(block.id)) continue
      const target = input.target as { model?: string; options?: Record<string, unknown> } | undefined
      const effort = target?.options?.effort ?? target?.options?.reasoningEffort
      started.set(block.id, {
        id: `task:${at}-${block.id.slice(-8)}`, // the call's own id keeps two calls in one millisecond apart
        label: String(input.title ?? input.task ?? 'Delegated task').slice(0, TITLE_CHARS),
        brief: String(input.task ?? '').slice(0, BRIEF_CHARS),
        type: 'delegated',
        model: target?.model,
        effort: effort == null ? undefined : String(effort),
        parentId: MAIN,
        now: 'running',
        startedAt: at,
        segments: [],
        mcp: {},
        usd: 0,
        tokens: 0,
        costKnown: false,
      })
    }
  }
  return [...started.values()].map(r => {
    if (!ended.has(r.label)) return r
    return { ...r, now: 'done' as const, ...(ended.get(r.label) ? { attention: 'failed' as const } : {}) }
  })
}

/** Add the transcript's T3 helpers this session has no row for (by child thread id, else by title). */
export async function recoverDelegated($: $) {
  let path = ''
  try {
    path = (await $.session.info()).transcriptPath
  } catch {
    return
  }
  if (!path) return
  const out = await $.process.run(['sh', '-c', TRANSCRIPT_GREP, 'sh', path]).catch(() => undefined)
  if (!out?.stdout) return
  const found = delegatedFromTranscript(out.stdout.split('\n').filter(Boolean))
  if (!found.length) return
  await updateRuns($, current => {
    const same = (r: Run, f: Run) => r.type === 'delegated' && ((!!f.childThreadId && r.childThreadId === f.childThreadId) || r.label === f.label)
    // Rows an earlier version recovered without a time (startedAt 0, all with one id) get the right time and id.
    let repaired = false
    const list = current.map(r => {
      const f = r.type === 'delegated' && r.startedAt === 0 ? found.find(x => x.startedAt && same(r, x)) : undefined
      if (!f) return r
      repaired = true
      return { ...r, id: f.id, startedAt: f.startedAt }
    })
    const missing = found.filter(f => !list.some(r => same(r, f)))
    if (!missing.length) return repaired ? list.sort((a, b) => (a.id === MAIN ? 1 : b.id === MAIN ? -1 : b.startedAt - a.startedAt)) : current
    // Oldest first into the list's newest-first order, so capRuns drops the oldest.
    const main = list.filter(r => r.id === MAIN)
    const rest = [...list.filter(r => r.id !== MAIN), ...missing.reverse()].sort((a, b) => b.startedAt - a.startedAt)
    return capRuns([...rest, ...main])
  })
}

