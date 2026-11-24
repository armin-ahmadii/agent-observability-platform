import { expect, test } from 'claude-code/testing'

import type { Run } from '../types'
import { answer, callTool, setup } from './harness'

const T1 = 'thread:delegated-task:command%3Amcp%3A00000000-0000-0000-0000-000000000000%3Adelegate-task%3A00000001'
type Snap = { runs: Run[] }

test('a T3 helper keeps its own name through follow-ups; each follow-up only adds a request', async ($, on) => {
  let titleCalls = 0
  const { clock, snapshot } = setup(on, {
    toolCall: (_: unknown, e: { tool: string }) =>
      /delegate_task$/.test(e.tool) ? { result: [{ type: 'text', text: JSON.stringify({ childThreadId: T1 }) }] } : { result: {} },
    modelComplete: (_: unknown, e: { system?: string }) => {
      if (String(e.system).includes('very short titles')) titleCalls++
      if (String(e.system).includes('title what a user asked')) return answer('{"title": "Check 560 light verification"}')
      return answer('Check: 560 light verification')
    },
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await callTool($, { tool: 'mcp__t3-code__delegate_task', title: 'Design: message track', task: 'Design the message track for the page' })
  await clock.advance(2000)
  await callTool($, { tool: 'mcp__t3-code__t3_thread_send', threadId: T1, message: 'Now verify it at 560 light please' })
  await callTool($, { tool: 'mcp__t3-code__t3_thread_send', threadId: T1, message: 'And check the dark mode too' })
  await clock.advance(2000)
  await clock.advance(2000)
  const task = snapshot<Snap>().runs.find(r => r.type === 'delegated')!
  expect([task.label, task.short]).toEqual(['Design: message track', 'Design: message track'])
  expect(titleCalls).toBe(0) // its label is already a title: no Haiku call at all
})

test('in a helper’s own session, the owner’s follow-up messages add asks and never give the main row a title', async ($, on) => {
  const { clock, snapshot } = setup(on, {
    modelComplete: (_: unknown, e: { system?: string }) =>
      String(e.system).includes('title what a user asked') ? answer('{"title": "Verify the design at 560 light"}') : answer('Check: 560 light verification'),
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'Design the message track for the dashboard page', wait: false } as never)
  await callTool($, { tool: 'mcp__subagent-deck__progress', ask: 'Design the message track', steps: ['Sketch it'] })
  await $.turn.complete({ answer: 'Designed.', reason: 'answer' } as never)
  await $.prompt.submit({ text: 'Now verify it at 560 light please', wait: false } as never)
  await clock.advance(2000)
  await clock.advance(2000)
  const main = snapshot<Snap>().runs.find(r => r.id === 'main')!
  expect(main.short).toBeUndefined()
  expect(main.asks!.map(a => a.title)).toEqual(['Design the message track', 'Verify the design at 560 light'])
})

test('rows an earlier version renamed on follow-ups get their names back at session start', async ($, on) => {
  const { clock, snapshot, files, fileEnding, compact } = setup(on, { ownState: true })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'Design the message track for the page', wait: false } as never)
  await clock.advance(2000)
  // The session file as the earlier version left it: renamed rows.
  const base = { brief: '', segments: [], mcp: {}, usd: 0, tokens: 0, now: 'done', startedAt: 5 }
  files[fileEnding('/sessions/s1.json')!] = JSON.stringify({
    sessionId: 's1',
    runs: [
      { ...base, id: 'task:5-1', type: 'delegated', label: 'Design: message track', short: 'Check: 560 light verification', childThreadId: T1 },
      { ...base, id: 'a1', type: 'agent', label: 'Totals view', short: 'Build: totals view' },
      { ...base, id: 'main', type: 'main', label: 'Main conversation', short: 'Check: 560 light verification', startedAt: 1 },
    ],
  })
  compact() // a resumed session starts with an empty state
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(2000)
  const runs = snapshot<Snap>().runs
  expect(runs.find(r => r.id === 'task:5-1')!.short).toBe('Design: message track')
  expect(runs.find(r => r.id === 'a1')!.short).toBe('Build: totals view') // a plain label keeps its Haiku title
  expect(runs.find(r => r.id === 'main')!.short).toBeUndefined()
  const titles = JSON.parse(files[fileEnding('/live/titles.json')!]!) as Record<string, string>
  expect(titles['task:Design: message track']).toBe('Design: message track')
})
