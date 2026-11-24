import { expect, test } from 'claude-code/testing'

import { answer, callTool, setup } from './harness'

const THREAD = 'thread:delegated-task:command%3Amcp%3A00000000-0000-0000-0000-000000000000%3Adelegate-task%3A00000000'

test('a message records where it was routed, and agents keep task lists and plans', async ($, on) => {
  let n = 0
  const { clock, snapshot } = setup(on, {
    agents: [{ id: 'a1', name: 'mod-helper' }],
    modelComplete: () => answer('["Read the hooks", "Add the fields", "Run the tests"]'),
    toolCall: (_: unknown, e: { tool: string; subject?: string; taskId?: string }) => {
      if (e.tool === 'TaskCreate') return { result: { task: { id: String(++n), subject: e.subject } } }
      if (e.tool === 'TaskUpdate') return { result: { success: true, taskId: e.taskId, updatedFields: ['status'] } }
      const reply = JSON.stringify({ taskId: 't9', childThreadId: THREAD })
      if (/delegate_task$/.test(e.tool)) return { result: [{ type: 'text', text: reply }], text: reply }
      return { result: {} }
    },
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'Please add routing data to the mod <system-reminder>secret</system-reminder>', wait: false } as never)
  await $.prompt.submit({ text: 'Delegated task node:delegated-task:command%3Amcp%3Aabc (Dashboard: motion) finished', wait: false } as never)
  await $.agent.spawn({ prompt: 'Add routing and task lists to the dashboard mod data', description: 'Mod routing data', subagentType: 'general-purpose' } as never)
  await callTool($, { tool: 'mcp__t3-code__delegate_task', title: 'Page work', task: 'Show the new routing data on the page' })
  await callTool($, { tool: 'SendMessage', to: 'mod-helper', message: 'One more thing' })
  await callTool($, { tool: 'mcp__t3-code__t3_thread_send', threadId: THREAD, message: 'Also this' })
  await callTool($, { tool: 'TaskCreate', subject: 'Read hooks', description: 'x', agentId: 'a1' })
  await callTool($, { tool: 'TaskCreate', subject: 'Write code', description: 'x', agentId: 'a1' })
  await callTool($, { tool: 'TaskUpdate', taskId: '1', status: 'completed', agentId: 'a1' })
  await callTool($, { tool: 'TaskUpdate', taskId: '2', status: 'in_progress', agentId: 'a1' })
  await callTool($, { tool: 'TodoWrite', todos: [{ content: 'Plan', status: 'completed', activeForm: 'Planning' }, { content: 'Ship', status: 'pending', activeForm: 'Shipping' }] })
  await $.turn.complete({ answer: 'Done', reason: 'answer' } as never)

  await clock.advance(2000)
  const snap = snapshot<{
    runs: { id: string; tasks?: unknown; plan?: unknown; childThreadId?: string; type: string }[]
    lastAsk: { text: string; routedTo: { kind: string; runId: string }[]; answeredAt?: number }
    recentAsks: unknown[]
  }>()
  const runs = snap.runs
  expect(snap.recentAsks.length).toBe(1)
  expect(JSON.stringify(snap.recentAsks)).not.toContain('Delegated task node')
  const ask = snap.lastAsk
  expect(ask.text).toBe('Please add routing data to the mod')
  expect(ask.answeredAt).toBeDefined()
  const delegated = runs.find(r => r.type === 'delegated')!
  expect(delegated.childThreadId).toBe(THREAD)
  expect(ask.routedTo.map(r => `${r.kind}:${r.runId}`)).toEqual(['subagent:a1', `delegated:${delegated.id}`, 'followup:a1', `followup:${delegated.id}`])
  expect(runs.find(r => r.id === 'a1')!.tasks).toEqual([
    { id: '1', text: 'Read hooks', status: 'done' },
    { id: '2', text: 'Write code', status: 'in_progress' },
  ])
  expect(runs.find(r => r.id === 'main')!.tasks).toEqual([{ text: 'Plan', status: 'done' }, { text: 'Ship', status: 'pending' }])
  expect(runs.find(r => r.id === 'a1')!.plan).toEqual(['Read the hooks', 'Add the fields', 'Run the tests'])
})
