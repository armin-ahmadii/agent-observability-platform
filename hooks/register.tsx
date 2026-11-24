// subagent-deck: traces every agent in a session (what it is doing, its tools,
// cost and steps), publishes that to the local dashboard every TICK_MS, and
// saves good agents as reusable helpers. This file only wires Claude Code's
// events to the modules that do the work.
import type { Register } from 'claude-code'

import { checkMainAfterReload, mainTurnStarted, sawMain, settleBlindMain } from './blind-main'
import { answerCommands, registerCommands } from './commands'
import { queueDone } from './done-lists'
import { gradeAgent } from './grades'
import { HELPER_PREFIX, countUse, learnFrom, loadHelpers, withoutNotebook } from './helpers'
import { drainInbox, publish } from './live'
import { PANE, PANE_TITLE, paneClockKey, registerPane } from './pane'
import { planRun } from './plans'
import { progressTool, registerProgressTool, reportProgress } from './progress'
import { RATE_BATCH_MS, noteMessage, rateBatch } from './reactions'
import { TASK_TOOLS, addRun, answerAsk, ensureRun, newRun, recordTasks, refreshUsage, route } from './runs'
import { loadRegistry, noteServerTool } from './servers'
import {
  ANSWER_CHARS,
  BRIEF_CHARS,
  MAIN,
  RESULT_CHARS,
  type Live,
  findRun,
  isTracked,
  patchRun,
  readSettings,
  session,
  getRuns,
  getHelpers,
  updateAsks,
} from './state'
import { NOTICE, delegate, noticeDone, runForThread } from './t3'
import { cleanAsk } from './text'
import { activityOf, mark } from './timeline'
import { followUp } from './titles'

/** How often the session snapshot is refreshed and published. */
const TICK_MS = 2000
const REGISTRY_RELOAD_MS = 30_000
/** T3's tools, whatever server prefix they are registered under. */
const T3_DELEGATE_TOOL = /delegate_task$/
const T3_THREAD_SEND_TOOL = /t3_thread_send$/

/** One line, the first RESULT_CHARS characters of an answer. */
const summary = (answer: string) => answer.replace(/\s+/g, ' ').trim().slice(0, RESULT_CHARS)

/** What paneClockKey gave at the last redraw the tick asked for. */
let lastClockKey = ''

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await readSettings($)
    await loadHelpers($)
    await registerProgressTool($)
    await registerCommands($)

    const env = await $.process.hookEnv()
    const live: Live = {
      id: env.CLAUDE_CODE_SESSION_ID ?? `session-${await $.clock.now()}`,
      project: e.cwd.split('/').filter(Boolean).pop() ?? e.cwd,
    }
    session.live = live
    await checkMainAfterReload($)
    $.clock.every(RATE_BATCH_MS, () => {
      void rateBatch($).catch(() => {})
    })
    await loadRegistry($)
    $.clock.every(REGISTRY_RELOAD_MS, () => {
      void loadRegistry($)
    })
    $.clock.every(TICK_MS, () => {
      void (async () => {
        const usage = await refreshUsage($)
        // The pane's time axis moves even when no run changed; redraw only when it would look different.
        const clockKey = paneClockKey(await getRuns($), await $.clock.now())
        if (clockKey !== lastClockKey) {
          lastClockKey = clockKey
          $.ui.invalidate('ui.render')
        }
        await publish($, live, usage)
        await drainInbox($, live)
        await settleBlindMain($)
      })().catch(() => undefined)
    })
    void $.ui.open({ id: PANE, title: PANE_TITLE })

    return next(e)
  })

  // A subagent starts: track it, and steer a repeat of a saved helper back to the live one.
  on('agent.spawn', async ($, e, next) => {
    const helperName = e.subagentType.startsWith(HELPER_PREFIX) ? e.subagentType.slice(HELPER_PREFIX.length) : undefined

    if (e.resume) {
      const id = e.resume.agentId
      const known = await findRun($, id)
      if (known) await mark($, id, 'thinking')
      await route($, { runId: id, label: known?.label ?? id, model: known?.model, kind: 'followup' })
      followUp($, known, e.prompt)
      return next(e)
    }

    if (helperName && !/^fresh\b/i.test(e.description)) {
      const live = (await getRuns($)).find(run => run.helper === helperName)
      const info = live ? (await $.agent.list()).find(a => a.id === live.id) : undefined
      if (info?.name) {
        return {
          deny: `"${helperName}" already worked in this session and still remembers it. Continue it with SendMessage to "${info.name}" instead. To start a fresh copy, begin the description with "fresh".`,
        }
      }
    }

    const started = await next(e)
    if (started.agentId) {
      const run = newRun({
        id: started.agentId,
        label: e.description || e.subagentType,
        brief: e.prompt.slice(0, BRIEF_CHARS),
        type: e.subagentType,
        model: started.model,
        helper: helperName,
        parentId: e.parentAgentId ?? MAIN,
        startedAt: await $.clock.now(),
      })
      await addRun($, run)
      await route($, { runId: run.id, label: run.label, model: run.model, kind: 'subagent' })
      $.ui.invalidate('ui.render')
      if (helperName) await countUse($, helperName)
    }
    return started
  })

  // Hide helpers that are switched off (or were renamed or forgotten) from the model.
  on('agent.offer', async ($, e, next) => {
    if (!e.agent.startsWith(HELPER_PREFIX)) return next(e)
    const name = e.agent.slice(HELPER_PREFIX.length)
    const helper = (await getHelpers($)).find(h => h.name === name)
    if (!helper || !helper.isOn) return { isOffered: false }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const id = e.agentId ?? MAIN
    if (id === MAIN) mainTurnStarted()
    await ensureRun($, id, e.text)
    await mark($, id, 'thinking')
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (session.live && !e.isMeta && !e.command && e.text.trim()) {
      const at = await $.clock.now()
      await noteMessage($, at, e.text)
      session.lastPromptAt = at
      const text = cleanAsk(e.text)
      if (NOTICE.test(text)) await noticeDone($, text).catch(() => {})
      else if (text) {
        await updateAsks($, list => [{ at, text, routedTo: [] }, ...list.filter(a => !NOTICE.test(a.text))].slice(0, 5))
        // The main conversation's planned steps come from the first message it sees;
        // later messages (in a T3 helper's session: t3_thread_send follow-ups) rename it.
        await ensureRun($, MAIN, e.text)
        const main = await findRun($, MAIN)
        if (main?.plan) followUp($, main, e.text)
        else void planRun($, MAIN, e.text)
      }
    }
    return next(e)
  })

  // Runs before every model request, so it does one state write and nothing else.
  on('turn.step', async function* ($, e, next) {
    const id = e.agentId ?? MAIN
    const at = await $.clock.now()
    if (id === MAIN) sawMain(at)
    // Also remember which model and effort this agent actually runs on.
    const effort = e.effort == null ? undefined : String(e.effort)
    await mark($, id, 'thinking', { at, patch: () => ({ model: e.model, effort }) })
    return yield* next(e)
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const args = e as unknown as Record<string, unknown>
    if (tool === progressTool) {
      const text = await reportProgress($, e.agentId ?? MAIN, args)
      return { result: text, text } as never
    }
    noteServerTool($, tool)
    const id = e.agentId ?? MAIN
    const at = await $.clock.now()
    if (id === MAIN) sawMain(at)
    // One write in the common case; an agent seen for the first time gets its row first.
    const act = activityOf(tool)
    if (!(await mark($, id, act, { tool, at }))) {
      await ensureRun($, id, '')
      await mark($, id, act, { tool, at })
    }

    if (T3_DELEGATE_TOOL.test(tool)) return delegate($, id, args, () => next(e))

    // A follow-up to a helper that already exists.
    if (tool === 'SendMessage') {
      const to = String(args.to ?? '').replace(/\s*\[[^\]]*\]$/, '')
      if (to && to !== MAIN) {
        const list = await getRuns($)
        const info = (await $.agent.list()).find(a => a.id === to || a.name === to)
        const run = list.find(r => r.id === (info?.id ?? to)) ?? list.find(r => r.helper === to || r.savedAs === to || r.label === to)
        await route($, { runId: run?.id ?? to, label: run?.label ?? to, model: run?.model, kind: 'followup' })
        followUp($, run, String(args.message ?? ''))
      }
    }
    if (T3_THREAD_SEND_TOOL.test(tool)) {
      const threadId = String(args.threadId ?? '')
      const run = await runForThread($, threadId)
      if (threadId) await route($, { runId: run?.id ?? threadId, label: run?.label ?? threadId, model: run?.model, kind: 'followup' })
      followUp($, run, String(args.message ?? ''))
    }
    if (TASK_TOOLS.test(tool)) {
      const out = await next(e)
      if (!out.deny && !out.isError) await recordTasks($, id, args, out.result).catch(() => {})
      return out
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const answer = String(e.answer ?? '')
    if (!e.agentId && (await isTracked($, MAIN))) {
      const used = e.usage ? e.usage.input_tokens + e.usage.output_tokens + e.usage.cache_creation_input_tokens : 0
      const said = summary(answer)
      await patchRun($, MAIN, r => ({ ...r, tokens: r.tokens + used, result: said || r.result }))
      // In a T3 helper's own session, this is the helper's checklist of what it did.
      const main = await findRun($, MAIN)
      if (main && session.live && said && !main.tasks?.length && !main.done) {
        queueDone($, { key: `main:${session.live.id}`, label: 'Main conversation', brief: main.brief, result: answer.slice(0, ANSWER_CHARS), runId: MAIN })
      }
      await mark($, MAIN, 'done')
      await answerAsk($, await $.clock.now())
      await refreshUsage($, MAIN)
      $.ui.invalidate('ui.render')
    }
    const id = e.agentId
    if (id && (await isTracked($, id))) {
      const handedBack = withoutNotebook(answer)
      const result = summary(handedBack)
      const attention = e.reason === 'error' || e.reason === 'refusal' ? ('error' as const) : undefined
      await patchRun($, id, r => ({ ...r, result: result || r.result, attention }))
      const run = await findRun($, id)
      if (run && result && !run.tasks?.length && !run.done) {
        queueDone($, { key: id, label: run.label, brief: run.brief, result: handedBack.slice(0, ANSWER_CHARS), runId: id })
      }
      if (run && result && !attention) {
        void gradeAgent($, { id, label: run.label, brief: run.brief, result, usd: run.usd, ms: (await $.clock.now()) - run.startedAt })
      }
      await mark($, id, 'done')
      await refreshUsage($, id)
      $.ui.invalidate('ui.render')
      if (run?.helper) await learnFrom($, run.helper, answer)
    }
    return next(e)
  })

  answerCommands(on)
  registerPane(on)
}
