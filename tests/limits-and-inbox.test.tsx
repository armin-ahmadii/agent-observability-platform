import { expect, test } from 'claude-code/testing'

import { answer, setup } from './harness'

test('past 40 runs the oldest agents go; the main row and background helper stay', async ($, on) => {
  let n = 0
  const { clock, snapshot } = setup(on, {
    spawned: () => ({ model: 'claude-opus-5-5', agentId: `a${++n}` }),
    modelComplete: () => answer('Build: something'),
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'Please start lots of agents for the page', wait: false } as never)
  await clock.advance(2000)
  const mainStarted = snapshot<{ runs: { id: string; startedAt: number }[] }>().runs.find(r => r.id === 'main')!.startedAt
  for (let i = 0; i < 45; i++) {
    await $.agent.spawn({ prompt: `Agent number ${i} does a task`, description: `Agent ${i}`, subagentType: 'general-purpose' } as never)
  }
  await $.tool.call({ tool: 'Read', file_path: '/x' } as never)
  await clock.advance(2000)
  const runs = snapshot<{ runs: { id: string; startedAt: number }[] }>().runs
  expect(runs.length).toBe(40)
  expect(runs.find(r => r.id === 'main')!.startedAt).toBe(mainStarted)
  expect(runs.some(r => r.id === 'triage')).toBe(true)
  expect(runs.some(r => r.id === 'a45')).toBe(true)
  expect(runs.some(r => r.id === 'a1')).toBe(false)
})

const title = (sessionId: string, label: string) => JSON.stringify({ sessionId, kind: 'title', items: [{ key: `k-${label}`, label, brief: 'x' }] }) + '\n'

test('presses that arrive while the inbox is drained, or for other sessions, are never lost', async ($, on) => {
  const named: string[] = []
  let race: (() => void) | undefined
  const { files, clock } = setup(on, {
    modelComplete: (_: unknown, e: { system?: string; prompt: string }) => {
      if (String(e.system).includes('titles')) named.push(/description: (\S+)/.exec(e.prompt)![1]!)
      return answer('Build: something')
    },
    beforeRun: argv => {
      if (argv[0] === 'mv' && race) {
        race()
        race = undefined
      }
    },
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(2000)
  const inbox = Object.keys(files).find(p => p.endsWith('/sessions/s1.json'))!.replace(/sessions\/s1\.json$/, 'inbox.jsonl')

  // Another session claims the inbox first: s1's move fails, and nothing is lost.
  files[inbox] = title('s1', 'first') + title('s2', 'other')
  const otherClaim = inbox.replace(/inbox\.jsonl$/, 'inbox.s2.claimed')
  race = () => {
    files[otherClaim] = files[inbox]!
    delete files[inbox]
  }
  await clock.advance(2000)
  expect(named).toEqual([])
  expect(files[otherClaim]).toContain('"first"')

  // s2 hands s1's line back; the server appends again right as s1 moves the file.
  files[inbox] = title('s1', 'first')
  delete files[otherClaim]
  race = () => {
    files[inbox] += title('s1', 'second') + title('s2', 'late')
  }
  await clock.advance(2000)
  expect(named).toEqual(['first', 'second'])
  // Other sessions' lines went back to the inbox; the claim is gone.
  expect(files[inbox]).toBe(title('s2', 'late'))
  expect(Object.keys(files).some(p => p.endsWith('.claimed'))).toBe(false)

  // An append that lands after the move starts a fresh inbox.jsonl, read next tick.
  files[inbox] = title('s1', 'third')
  await clock.advance(2000)
  files[inbox] = (files[inbox] ?? '') + title('s1', 'fourth')
  await clock.advance(2000)
  expect(named).toEqual(['first', 'second', 'third', 'fourth'])
})

test('a notebook mention before the real notebook does not cut the answer short', async ($, on) => {
  const { clock, snapshot } = setup(on, {})
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({ prompt: 'Explain the notebook rule', description: 'Notebook', subagentType: 'general-purpose' } as never)
  await $.turn.complete({ agentId: 'a1', answer: 'The NOTEBOOK: line goes last. I updated the docs.\nNOTEBOOK:\n- likes short answers', reason: 'answer' } as never)
  await clock.advance(2000)
  const run = snapshot<{ runs: { id: string; result?: string }[] }>().runs.find(r => r.id === 'a1')!
  expect(run.result).toBe('The NOTEBOOK: line goes last. I updated the docs.')
})

test('two delegate_task calls in the same millisecond get their own rows', async ($, on) => {
  const { clock, snapshot } = setup(on, {})
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await Promise.all([
    $.tool.call({ tool: 'mcp__t3-code__delegate_task', title: 'One', task: 'First task' } as never),
    $.tool.call({ tool: 'mcp__t3-code__delegate_task', title: 'Two', task: 'Second task' } as never),
  ])
  await clock.advance(2000)
  const tasks = snapshot().runs.filter(r => r.type === 'delegated')
  expect(tasks.length).toBe(2)
  expect(new Set(tasks.map(r => r.id)).size).toBe(2)
  expect(tasks.every(r => r.id.startsWith('task:'))).toBe(true)
})
