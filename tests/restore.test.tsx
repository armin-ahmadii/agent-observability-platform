import { expect, test } from 'claude-code/testing'

import { mergeRuns } from '../hooks/restore'
import { delegatedFromTranscript } from '../hooks/transcript'
import type { Run } from '../types'
import { callTool, setup } from './harness'

const T1 = 'thread:delegated-task:command%3Amcp%3A00000000-0000-0000-0000-000000000000%3Adelegate-task%3A00000001'
const T2 = 'thread:delegated-task:command%3Amcp%3A00000000-0000-0000-0000-000000000000%3Adelegate-task%3A00000002'
const TRANSCRIPT = '/home/u/.claude/projects/p/s1.jsonl'
const line = (o: object) => JSON.stringify(o)
const delegateUse = (id: string, title: string, at: string) =>
  line({ type: 'assistant', timestamp: at, message: { content: [{ type: 'tool_use', id, name: 'mcp__t3-code__delegate_task', input: { title, task: `Do ${title}`, target: { model: 'claude-opus-5-5' } } }] } })
const delegateResult = (id: string, thread: string) =>
  line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: JSON.stringify({ taskId: 'x', childThreadId: thread }) }] }] } })
const notice = (title: string, status: string) =>
  line({ type: 'user', message: { content: `Delegated task node:delegated-task:command%3Amcp%3A00000000%3Adelegate-task%3A00000001 (${title}) [${status}]: All done.` } })
const followUpUse = (thread: string) =>
  line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'f1', name: 'mcp__t3-code__t3_thread_send', input: { threadId: thread, message: 'One more thing' } }] } })

test('the transcript gives back each T3 helper, done or at work again after a follow-up', () => {
  const runs = delegatedFromTranscript([
    delegateUse('u1', 'Page polish', '2026-11-24T10:00:00Z'),
    delegateResult('u1', T1),
    delegateUse('u2', 'Server fixes', '2026-11-24T10:01:00Z'),
    delegateResult('u2', T2),
    notice('Page polish', 'completed'),
    notice('Server fixes', 'failed'),
    followUpUse(T1),
    'not json',
    // A request copy repeats the call without a timestamp: ignored.
    line({ type: 'api-request-blob', message: { content: [{ type: 'tool_use', id: 'u1', name: 'mcp__t3-code__delegate_task', input: { title: 'Page polish' } }] } }),
  ])
  expect(runs.map(r => [r.label, r.childThreadId, r.now, r.attention ?? null, r.type, r.parentId])).toEqual([
    ['Page polish', T1, 'running', null, 'delegated', 'main'],
    ['Server fixes', T2, 'done', 'failed', 'delegated', 'main'],
  ])
  expect(runs[0]!.startedAt).toBe(Date.parse('2026-11-24T10:00:00Z'))
  expect(runs[0]!.model).toBe('claude-opus-5-5')
})

test('merging keeps every saved row, adds what was made since, and the main row stays last', () => {
  const base = { brief: '', segments: [], mcp: {}, usd: 0, tokens: 0 }
  const saved: Run[] = [
    { ...base, id: 'a1', label: 'Agent', type: 'agent', now: 'done', startedAt: 5, tokens: 100 },
    { ...base, id: 'main', label: 'Main conversation', type: 'main', now: 'done', startedAt: 1, tokens: 50, mcp: { Paper: 2 }, segments: [{ key: 'thinking', label: 'Thinking', start: 1, end: 2, tokensAtStart: 0, tokens: 5 }] },
  ]
  const current: Run[] = [
    { ...base, id: 'a2', label: 'New agent', type: 'agent', now: 'thinking', startedAt: 20 },
    { ...base, id: 'main', label: 'Main conversation', type: 'main', now: 'thinking', startedAt: 30, tokens: 7, mcp: { Paper: 1 }, segments: [{ key: 'thinking', label: 'Thinking', start: 30, end: 31, tokensAtStart: 0, tokens: 1 }] },
  ]
  const merged = mergeRuns(saved, current)
  expect(merged.map(r => r.id)).toEqual(['a2', 'a1', 'main'])
  const main = merged[2]!
  expect([main.startedAt, main.tokens, main.mcp, main.segments.length, main.now]).toEqual([1, 57, { Paper: 3 }, 2, 'thinking'])
})

test('after a compaction empties the state, every row comes back from the session file', async ($, on) => {
  const { clock, snapshot, compact } = setup(on, {
    ownState: true,
    toolCall: (_: unknown, e: { tool: string }) =>
      /delegate_task$/.test(e.tool) ? { result: [{ type: 'text', text: JSON.stringify({ childThreadId: T1 }) }] } : { result: {} },
  })
  type Snap = { runs: Run[]; recentAsks: { text: string }[] }
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'Please build the totals view for the page', wait: false } as never)
  await $.agent.spawn({ prompt: 'Build the totals view', description: 'Totals view', subagentType: 'general-purpose' } as never)
  await callTool($, { tool: 'mcp__t3-code__delegate_task', title: 'Page polish', task: 'Polish the page' })
  await $.turn.complete({ answer: 'Started both.', reason: 'answer' } as never)
  await clock.advance(2000)
  const before = snapshot<Snap>()
  const mainBefore = before.runs.find(r => r.id === 'main')!
  expect(before.runs.map(r => r.label).sort()).toEqual(['Background helper', 'Main conversation', 'Page polish', 'Totals view'])

  compact()
  await $.prompt.submit({ text: 'Now check on the page polish helper please', wait: false } as never)
  await callTool($, { tool: 'mcp__t3-code__t3_thread_send', threadId: T1, message: 'How is it going?' })
  await clock.advance(2000)
  const after = snapshot<Snap & { lastAsk: { routedTo: { kind: string; runId: string }[] } }>()
  expect(after.runs.map(r => r.label).sort()).toEqual(['Background helper', 'Main conversation', 'Page polish', 'Totals view'])
  const task = after.runs.find(r => r.type === 'delegated')!
  expect(task.id).toBe(before.runs.find(r => r.type === 'delegated')!.id)
  expect(task.childThreadId).toBe(T1)
  expect(after.lastAsk.routedTo).toEqual([{ runId: task.id, label: 'Page polish', kind: 'followup' }])
  const main = after.runs.find(r => r.id === 'main')!
  expect(main.startedAt).toBe(mainBefore.startedAt)
  expect(main.asks!.map(a => a.title)).toEqual(['Please build the totals view for the', 'Now check on the page polish helper'])
  expect(after.recentAsks.map(a => a.text)).toEqual(['Now check on the page polish helper please', 'Please build the totals view for the page'])
})

test('a follow-up to a T3 helper this session lost re-attaches it from the transcript', async ($, on) => {
  const { files, clock, snapshot } = setup(on, { ownState: true, transcript: TRANSCRIPT })
  files[TRANSCRIPT] = line({ type: 'user', message: { content: 'hello' } }) + '\n'
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(2000)
  expect(snapshot<{ runs: Run[] }>().runs.some(r => r.type === 'delegated')).toBe(false)

  // The helper was delegated earlier in this session (its row since lost); the owner follows up.
  files[TRANSCRIPT] += [delegateUse('u1', 'Page polish', '2026-11-24T10:00:00Z'), delegateResult('u1', T1), notice('Page polish', 'completed')].join('\n') + '\n'
  await $.prompt.submit({ text: 'Ask the page helper to add one more fix', wait: false } as never)
  await callTool($, { tool: 'mcp__t3-code__t3_thread_send', threadId: T1, message: 'One more fix' })
  await clock.advance(2000)
  const snap = snapshot<{ runs: Run[]; lastAsk: { routedTo: { kind: string; runId: string; label: string }[] } }>()
  const task = snap.runs.find(r => r.type === 'delegated')!
  expect([task.label, task.childThreadId, task.parentId]).toEqual(['Page polish', T1, 'main'])
  expect(snap.lastAsk.routedTo).toEqual([{ runId: task.id, label: 'Page polish', model: 'claude-opus-5-5', kind: 'followup' }])
})

test('a session start with the state intact (a hot reload) adds nothing twice', async ($, on) => {
  const { files, clock, snapshot } = setup(on, { ownState: true, transcript: TRANSCRIPT })
  files[TRANSCRIPT] = [delegateUse('u1', 'Page polish', '2026-11-24T10:00:00Z'), delegateResult('u1', T1)].join('\n') + '\n'
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'Please build the totals view for the page', wait: false } as never)
  await callTool($, { tool: 'Read', file_path: '/x' })
  await $.turn.complete({ answer: 'Done.', usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, reason: 'answer' } as never)
  await clock.advance(2000)
  const before = snapshot<{ runs: Run[] }>().runs
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(2000)
  await clock.advance(2000)
  const after = snapshot<{ runs: Run[] }>().runs
  expect(after.map(r => r.id)).toEqual(before.map(r => r.id))
  expect(after.filter(r => r.type === 'delegated').length).toBe(1)
  const main = (rs: Run[]) => rs.find(r => r.id === 'main')!
  expect([main(after).tokens, main(after).segments.length]).toEqual([main(before).tokens, main(before).segments.length])
})

test('T3’s "[completed]" notice closes the parent’s row for that helper', async ($, on) => {
  const { clock, snapshot } = setup(on, {})
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await callTool($, { tool: 'mcp__t3-code__delegate_task', title: 'Page polish', task: 'Polish the page' })
  await clock.advance(2000)
  const long = `Delegated task node:delegated-task:command%3Amcp%3A00000000-0000-0000-0000-000000000000%3Adelegate-task%3A00000000-0000-0000-0000-000000000001 (Page polish) [completed]: Polished the spacing.`
  await $.prompt.submit({ text: long, wait: false } as never)
  await clock.advance(2000)
  expect(snapshot<{ runs: Run[] }>().runs.find(r => r.type === 'delegated')!.now).toBe('done')
})

test('rows an earlier version recovered without a time get their time and own id back', async ($, on) => {
  const { files, clock, snapshot, fileEnding, compact } = setup(on, { ownState: true, transcript: TRANSCRIPT })
  const lost = (label: string, thread: string): Run => ({ id: 'task:0-t', label, brief: '', type: 'delegated', parentId: 'main', now: 'done', startedAt: 0, segments: [], mcp: {}, usd: 0, tokens: 0, childThreadId: thread })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'Start the page and server helpers please', wait: false } as never)
  await clock.advance(2000)
  // The session file as the earlier version left it; then the state is emptied and read back from it.
  files[fileEnding('/sessions/s1.json')!] = JSON.stringify({ sessionId: 's1', runs: [lost('Page polish', T1), lost('Server fixes', T2)] })
  files[TRANSCRIPT] = [
    delegateUse('toolu_aaaaaaaa', 'Page polish', '2026-11-24T10:00:00Z'), delegateResult('toolu_aaaaaaaa', T1),
    delegateUse('toolu_bbbbbbbb', 'Server fixes', '2026-11-24T10:01:00Z'), delegateResult('toolu_bbbbbbbb', T2),
  ].join('\n') + '\n'
  compact()
  await $.prompt.submit({ text: 'Show me where the helpers are at', wait: false } as never)
  await clock.advance(2000)
  const tasks = snapshot<{ runs: Run[] }>().runs.filter(r => r.type === 'delegated')
  expect(tasks.map(r => [r.label, r.startedAt])).toEqual([
    ['Server fixes', Date.parse('2026-11-24T10:01:00Z')],
    ['Page polish', Date.parse('2026-11-24T10:00:00Z')],
  ])
  expect(new Set(tasks.map(r => r.id)).size).toBe(2)
})
