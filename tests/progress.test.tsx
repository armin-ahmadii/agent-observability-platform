import { expect, test } from 'claude-code/testing'

import { answer, setup } from './harness'

test('agents report progress with the progress tool; a follow-up refreshes the title', async ($, on) => {
  const registered: { name: string; isDeferred?: boolean }[] = []
  let reached = 0
  const calls: Record<string, string[]> = {}
  const { clock, snapshot } = setup(on, {
    agents: [{ id: 'a1', name: 'view-helper' }],
    onToolRegister: spec => registered.push(spec),
    toolCall: () => (reached++, { result: {} }),
    modelComplete: (_: unknown, e: { system?: string; prompt: string }) => {
      const sys = String(e.system ?? '')
      const kind = sys.includes('planned steps') ? 'plan' : sys.includes('titles') ? 'title' : 'other'
      ;(calls[kind] ??= []).push(e.prompt)
      if (kind === 'plan') return answer('["Guess one", "Guess two", "Guess three"]')
      if (kind === 'title') return answer(calls.title!.length === 1 ? 'Build: 24h totals view' : 'Fix: tooltip removal')
      return { value: { isAnswered: false, text: '' } }
    },
  })
  type R = { id: string; short?: string; plan?: string[]; planSource?: string; planDone?: number[]; planNow?: number; nowText?: string; nowAt?: number }
  const run = (id: string) => snapshot<{ runs: R[] }>().runs.find(r => r.id === id)!
  const progress = (input: Record<string, unknown>) => $.tool.call({ tool: 'mcp__subagent-deck__progress', ...input } as never) as Promise<{ text?: string }>

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(registered.map(t => t.name)).toEqual(['progress'])
  expect(registered[0]!.isDeferred).toBe(false)

  await $.agent.spawn({ prompt: 'Build the 24h totals view on the dashboard page', description: '24h totals view', subagentType: 'general-purpose' } as never)
  await clock.advance(2000)
  let a1 = run('a1')
  expect(a1.short).toBe('Build: 24h totals view')
  expect(a1.plan).toEqual(['Guess one', 'Guess two', 'Guess three'])
  expect(a1.planSource).toBe('guess')
  expect(a1.planDone).toBeUndefined()

  // The agent reports its own steps: they replace the guess, and nothing calls a model.
  const before = (calls.plan?.length ?? 0) + (calls.title?.length ?? 0)
  const out = await progress({ agentId: 'a1', steps: ['Read the view code', 'Build the totals view', 'Run the tests'], current: 0, now: 'Reading Agents.tsx and the store' })
  expect(out.text).toBe('ok (0/3 done)')
  await progress({ agentId: 'a1', done: [0], current: 1, now: 'Editing Agents.tsx' })
  await clock.advance(2000)
  a1 = run('a1')
  expect(a1.plan).toEqual(['Read the view code', 'Build the totals view', 'Run the tests'])
  expect(a1.planSource).toBe('agent')
  expect(a1.planDone).toEqual([0])
  expect(a1.planNow).toBe(1)
  expect(a1.nowText).toBe('Editing Agents.tsx')
  expect(a1.nowAt).toBe(1_002_000)
  expect(reached).toBe(0)

  // A follow-up: a new title from it; the agent appends its own steps.
  await $.tool.call({ tool: 'SendMessage', to: 'view-helper', message: 'Also remove the tooltips from the agents list' } as never)
  await progress({ agentId: 'a1', steps: ['Read the view code', 'Build the totals view', 'Run the tests', 'Remove the tooltips'], done: [1, 2, 9], current: 3, now: 'Removing tooltips from Agents.tsx please now' })
  await clock.advance(2000)
  a1 = run('a1')
  expect(a1.short).toBe('Fix: tooltip removal')
  expect(calls.title![1]).toContain('remove the tooltips')
  expect(a1.plan!.length).toBe(4)
  expect(a1.planDone).toEqual([0, 1, 2])
  expect(a1.planNow).toBe(3)
  expect(a1.nowText).toBe('Removing tooltips from Agents.tsx please')
  expect((calls.plan?.length ?? 0) + (calls.title?.length ?? 0)).toBe(before + 1)

  // The main conversation (a T3 helper's own session) reports too.
  await progress({ steps: ['Do it'], done: [0], now: 'Wrapping up' })
  await clock.advance(2000)
  expect(run('main').planDone).toEqual([0])
  expect(run('main').nowText).toBe('Wrapping up')
})
