import { expect, test } from 'claude-code/testing'

import { answer, setup } from './harness'

test('background helper logs its jobs; a missed turn end and a T3 notice still finish rows', async ($, on) => {
  const { clock, snapshot } = setup(on, {
    modelComplete: (_: unknown, e: { system?: string }) => {
      const sys = String(e.system ?? '')
      if (sys.includes('titles')) return answer('Build: totals view')
      if (sys.includes('planned steps')) throw new Error('timeout')
      return { value: { isAnswered: false, text: '' } }
    },
  })
  type R = { id: string; type: string; now: string; triageJobs?: { what: string; at: number; ok: boolean }[] }
  const runs = () => snapshot<{ runs: R[] }>().runs

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({ prompt: 'Build the 24h totals view on the dashboard page', description: 'Totals view', subagentType: 'general-purpose' } as never)
  await clock.advance(2000)
  const jobs = runs().find(r => r.id === 'triage')!.triageJobs!
  expect(jobs.map(j => [j.what, j.ok])).toEqual([['Named an agent', true], ['Planning "Totals view"', false]])
  expect(jobs[0]!.at).toBeGreaterThanOrEqual(1_000_000)
  expect(runs().find(r => r.id === 'triage')!.now).toBe('done')

  // The main turn is running when the module reloads: the new copy never hears its end.
  await $.prompt.submit({ text: 'Please build the totals view for the page', wait: false } as never)
  await $.tool.call({ tool: 'Read', file_path: '/x/a.ts' } as never)
  await clock.advance(2000)
  expect(runs().find(r => r.id === 'main')!.now).not.toBe('done')
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(58_000)
  expect(runs().find(r => r.id === 'main')!.now).not.toBe('done')
  await clock.advance(34_000)
  expect(runs().find(r => r.id === 'main')!.now).toBe('done')

  // A T3 "finished" notice closes the parent's row for that task.
  await $.tool.call({ tool: 'mcp__t3-code__delegate_task', title: 'Plan: agent self-reporting', task: 'Make agents report progress' } as never)
  await clock.advance(2000)
  expect(runs().find(r => r.type === 'delegated')!.now).toBe('running')
  await $.prompt.submit({ text: 'Delegated task node:delegated-task:command%3Amcp%3Aabc (Plan: agent self-reporting) finished', wait: false } as never)
  await clock.advance(2000)
  expect(runs().find(r => r.type === 'delegated')!.now).toBe('done')
})
