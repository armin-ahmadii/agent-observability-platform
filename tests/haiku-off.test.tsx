import { expect, test } from 'claude-code/testing'

import { haikuSwitch } from '../hooks/state'
import { answer, callTool, setup } from './harness'

test('SUBAGENT_DECK_HAIKU accepts off, 0, false and no in any case; anything else is on', () => {
  for (const v of ['off', 'OFF', ' Off ', '0', 'false', 'False', 'no', 'NO']) expect(haikuSwitch(v)).toBe(false)
  for (const v of [undefined, '', 'on', '1', 'true', 'yes', 'offline']) expect(haikuSwitch(v)).toBe(true)
})

test('with Haiku off, a busy session makes no model calls and keeps every row', async ($, on) => {
  let n = 0
  let modelCalls = 0
  const { files, clock, snapshot, fileEnding } = setup(on, {
    env: { SUBAGENT_DECK_HAIKU: 'Off' },
    agents: [{ id: 'a1', name: 'page-helper' }],
    spawned: () => ({ model: 'claude-opus-5-5', agentId: `a${++n}` }),
    modelComplete: () => (modelCalls++, answer('Build: should not happen')),
  })
  const call = (input: Record<string, unknown>) => callTool($, input)
  const progress = (input: Record<string, unknown>) => call({ tool: 'mcp__subagent-deck__progress', ...input })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'Great work!! Now build the totals view for the dashboard page', wait: false } as never)
  await $.agent.spawn({ prompt: 'Build the totals view on the dashboard page', description: 'Totals view', subagentType: 'general-purpose' } as never)
  await $.agent.spawn({ prompt: 'Research chart references for the page', description: 'Chart references', subagentType: 'general-purpose' } as never)
  await call({ tool: 'mcp__brandnew__write_thing', agentId: 'a1' })
  await progress({ agentId: 'a1', steps: ['Read the code', 'Build the view'], done: [0], current: 1, now: 'Building the view' })
  await call({ tool: 'SendMessage', to: 'page-helper', message: 'Also add a legend to the chart' })
  await call({ tool: 'mcp__t3-code__delegate_task', title: 'Page polish', task: 'Polish the spacing on the page' })
  await $.turn.complete({ agentId: 'a1', answer: 'Built the totals view and added the legend.', reason: 'answer' } as never)
  await $.turn.complete({ answer: 'All done.', reason: 'answer' } as never)

  // The page asks for titles, a done-list, a grade and a reaction reading.
  const inbox = fileEnding('/sessions/s1.json') ?? (await clock.advance(2000), fileEnding('/sessions/s1.json')!)
  const dir = inbox.replace(/sessions\/s1\.json$/, '')
  const line = (o: object) => JSON.stringify({ sessionId: 's1', ...o }) + '\n'
  files[`${dir}inbox.jsonl`] =
    line({ kind: 'title', items: [{ key: 'old', label: 'Old agent', brief: 'Fix the tooltip overlap' }] }) +
    line({ kind: 'done', items: [{ id: 'old', label: 'Old agent', brief: 'Fix it', result: 'Fixed the tooltip.' }] }) +
    line({ kind: 'grade', grade: { id: 'old', label: 'Old agent', brief: 'Fix it', result: 'Fixed the tooltip.' } }) +
    line({ kind: 'rate', item: { at: 1, sessionId: 's1', project: 'x', text: 'love it!!', candidates: [{ id: 'a1', label: 'Totals view', kind: 'subagent', result: 'ok' }] } })
  await clock.advance(2000)
  await clock.advance(31 * 60_000) // past the reaction batch

  expect(modelCalls).toBe(0)
  type R = { id: string; label: string; type: string; now: string; short?: string; plan?: string[]; planDone?: number[]; nowText?: string; done?: string[]; triageJobs?: unknown[]; attention?: string }
  const runs = snapshot<{ runs: R[] }>().runs
  expect(runs.map(r => r.label).sort()).toEqual(['Chart references', 'Main conversation', 'Page polish', 'Totals view'])
  expect(runs.some(r => r.type === 'triage' || r.triageJobs)).toBe(false)
  expect(runs.every(r => r.short === undefined && r.done === undefined && r.attention === undefined)).toBe(true)
  const a1 = runs.find(r => r.id === 'a1')!
  expect(a1.now).toBe('done')
  expect(a1.plan).toEqual(['Read the code', 'Build the view'])
  expect(a1.planDone).toEqual([0])
  expect(a1.nowText).toBe('Building the view')
  expect(runs.find(r => r.id === 'a2')!.plan).toBeUndefined()
  // No Haiku stores written; the new server has no registry entry (the page names and colours it itself).
  for (const name of ['servers.json', 'titles.json', 'done.json', 'grades.json']) expect(fileEnding(`/live/${name}`)).toBeUndefined()
  expect(Object.keys(files).some(p => p.includes('/memory/'))).toBe(false)
  expect(snapshot<{ serverTokens: Record<string, number> }>().serverTokens).toHaveProperty('Brandnew')
})
