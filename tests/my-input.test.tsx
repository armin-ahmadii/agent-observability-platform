import { expect, test } from 'claude-code/testing'

import type { RoutedAsk, Run } from '../types'
import { callTool, setup } from './harness'

const T1 = 'thread:delegated-task:command%3Amcp%3A00000000-0000-0000-0000-000000000000%3Adelegate-task%3A00000001'
type Snap = { runs: Run[]; lastAsk: RoutedAsk | null; recentAsks: RoutedAsk[]; t3ThreadId?: string }

test('your message, each route and the answer reach the session file at once, not on the next tick', async ($, on) => {
  const { clock, snapshot, fileEnding, files } = setup(on, {
    agents: [{ id: 'a1', name: 'page-helper' }],
    toolCall: (_: unknown, e: { tool: string }) =>
      /delegate_task$/.test(e.tool) ? { result: [{ type: 'text', text: JSON.stringify({ childThreadId: T1 }) }] } : { result: {} },
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(2000) // the first tick writes the file
  const settle = () => clock.advance(1) // lets queued work run; the 2s tick is not due
  const lastAsk = () => snapshot<Snap>().lastAsk!

  await $.prompt.submit({ text: 'Build the totals view and polish the page', wait: false } as never)
  await settle()
  expect(lastAsk().text).toBe('Build the totals view and polish the page')
  expect(lastAsk().routedTo).toEqual([])

  await $.agent.spawn({ prompt: 'Build the totals view', description: 'Totals view', subagentType: 'general-purpose' } as never)
  await settle()
  await callTool($, { tool: 'mcp__t3-code__delegate_task', title: 'Page polish', task: 'Polish the page' })
  await settle()
  await callTool($, { tool: 'mcp__t3-code__t3_thread_send', threadId: T1, message: 'Also the spacing' })
  await settle()
  const snap = snapshot<Snap>()
  const task = snap.runs.find(r => r.type === 'delegated')!
  expect(snap.lastAsk!.routedTo.map(r => [r.kind, r.runId])).toEqual([['subagent', 'a1'], ['delegated', task.id], ['followup', task.id]])
  // Every route points at a row the page shows.
  for (const r of snap.lastAsk!.routedTo) expect(snap.runs.some(x => x.id === r.runId)).toBe(true)

  await $.turn.complete({ answer: 'On it.', reason: 'answer' } as never)
  await settle()
  expect(lastAsk().answeredAt).toBeDefined()
  expect(Object.keys(files).filter(p => p === fileEnding('/sessions/s1.json')).length).toBe(1)
})

test('a T3 helper records its thread; the parent’s routes to it name the helper’s own session', async ($, on) => {
  // The helper's own session (T3 sets T3CODE_THREAD_ID there).
  const helper = setup(on, {
    env: { T3CODE_THREAD_ID: T1 },
    toolCall: (_: unknown, e: { tool: string }) =>
      /delegate_task$/.test(e.tool) ? { result: [{ type: 'text', text: JSON.stringify({ childThreadId: T1 }) }] } : { result: {} },
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await helper.clock.advance(2000)
  expect(helper.snapshot<Snap>().t3ThreadId).toBe(T1)
  const threadFile = Object.keys(helper.files).find(p => p.includes('/threads/'))!
  expect(JSON.parse(helper.files[threadFile]!)).toEqual({ threadId: T1, sessionId: 's1' })

  // The same session also acts as a parent here: a delegated route gets the child session once it is known,
  // and a follow-up names it straight away.
  delete helper.files[threadFile]
  await $.prompt.submit({ text: 'Polish the page spacing please now', wait: false } as never)
  await callTool($, { tool: 'mcp__t3-code__delegate_task', title: 'Page polish', task: 'Polish the page' })
  await helper.clock.advance(2000)
  expect(helper.snapshot<Snap>().lastAsk!.routedTo[0]!.sessionId).toBeUndefined()
  helper.files[threadFile] = JSON.stringify({ threadId: T1, sessionId: 'child-1' })
  await helper.clock.advance(2000)
  expect(helper.snapshot<Snap>().lastAsk!.routedTo[0]!.sessionId).toBe('child-1')
  await callTool($, { tool: 'mcp__t3-code__t3_thread_send', threadId: T1, message: 'And the colours' })
  await helper.clock.advance(1)
  const routes = helper.snapshot<Snap>().lastAsk!.routedTo
  expect(routes.map(r => [r.kind, r.sessionId])).toEqual([['delegated', 'child-1'], ['followup', 'child-1']])
})
