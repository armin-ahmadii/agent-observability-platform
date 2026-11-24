import { expect, test } from 'claude-code/testing'

import { MAX_ASKS, applyProgress, startAsk } from '../hooks/asks'
import type { Run } from '../types'
import { answer, callTool, setup } from './harness'

const run = (over: Partial<Run> = {}): Run => ({ id: 'a1', label: 'Fix the failed rows page', brief: '', type: 'agent', now: 'thinking', startedAt: 0, segments: [], mcp: {}, usd: 0, tokens: 0, ...over })

test('a new ask title starts a group; the same or no title updates the latest', () => {
  let r = applyProgress(run(), { ask: 'Add resolve button to failed rows', steps: ['Read the row code', 'Add the button'], current: 0 }, 10, 'x')
  r = applyProgress(r, { done: [0], current: 1, now: 'Adding the button' }, 20, 'x')
  r = applyProgress(r, { ask: 'Add resolve button to failed rows', done: [1] }, 30, 'x')
  expect(r.asks).toEqual([{ title: 'Add resolve button to failed rows', at: 10, steps: ['Read the row code', 'Add the button'], done: [0, 1], nowText: 'Adding the button' }])

  r = applyProgress(r, { ask: 'Make the timeline bars thinner please now', steps: ['Find the bar styles'] }, 40, 'x')
  expect(r.asks!.map(a => a.title)).toEqual(['Add resolve button to failed rows', 'Make the timeline bars thinner please now'])
  expect(r.asks![0]!.finishedAt).toBe(40) // all its steps were done
  expect(r.asks![1]).toEqual({ title: 'Make the timeline bars thinner please now', at: 40, steps: ['Find the bar styles'], done: [] })
})

test('an ask left with steps undone is not marked finished; titles are clipped to 7 words', () => {
  let r = applyProgress(run(), { ask: 'One', steps: ['a', 'b'], done: [0] }, 1, 'x')
  r = applyProgress(r, { ask: 'Two words and then some more words here', steps: ['c'] }, 2, 'x')
  expect(r.asks![0]!.finishedAt).toBeUndefined()
  expect(r.asks![1]!.title).toBe('Two words and then some more words')
})

test('steps sent before any ask go into one titled from the label', () => {
  const r = applyProgress(run(), { steps: ['Read it', 'Fix it'], current: 0 }, 5, 'Fix the failed rows page')
  expect(r.asks).toEqual([{ title: 'Fix the failed rows page', at: 5, steps: ['Read it', 'Fix it'], done: [], now: 0 }])
})

test('a "now" line alone starts no group; steps already on the legacy plan become the first ask', () => {
  const quiet = applyProgress(run(), { now: 'Looking around' }, 1, 'x')
  expect(quiet.asks).toBeUndefined()
  expect(quiet.nowText).toBe('Looking around')
  const before = run({ plan: ['A', 'B'], planSource: 'agent', planDone: [0], planNow: 1 })
  const r = applyProgress(before, { done: [1] }, 2, 'Fix the failed rows page')
  expect(r.asks).toEqual([{ title: 'Fix the failed rows page', at: 2, steps: ['A', 'B'], done: [0, 1] }])
  expect(r.planDone).toEqual([0, 1])
})

test('only the last 20 asks are kept', () => {
  let r = run()
  for (let i = 0; i < 25; i++) r = applyProgress(r, { ask: `Request number ${i}`, steps: ['Do it'] }, i, 'x')
  expect(r.asks!.length).toBe(MAX_ASKS)
  expect(r.asks![0]!.title).toBe('Request number 5')
  expect(r.asks![19]!.title).toBe('Request number 24')
})

test('plan, planDone, planNow and nowText mirror the latest ask', () => {
  let r = applyProgress(run({ plan: ['Guess'], planSource: 'guess' }), { ask: 'First request here', now: 'Looking around' }, 1, 'x')
  expect(r.plan).toEqual(['Guess']) // no steps yet: the guessed plan stays, as before
  expect(r.nowText).toBe('Looking around')
  r = applyProgress(r, { steps: ['A', 'B', 'C'], done: [0], current: 1 }, 2, 'x')
  expect([r.plan, r.planSource, r.planDone, r.planNow]).toEqual([['A', 'B', 'C'], 'agent', [0], 1])
  r = applyProgress(r, { ask: 'Second request here' }, 3, 'x')
  expect([r.plan, r.planSource, r.planDone, r.planNow]).toEqual([undefined, undefined, undefined, undefined])
  r = applyProgress(r, { steps: ['D'], current: 0 }, 4, 'x')
  expect([r.plan, r.planDone, r.planNow]).toEqual([['D'], [], 0])
  expect(startAsk(r, 'Third', 5).asks!.length).toBe(3)
})

test('helpers group their steps by ask and close the last one when they finish', async ($, on) => {
  const { clock, snapshot } = setup(on, {})
  const progress = (input: Record<string, unknown>) => callTool($, { tool: 'mcp__subagent-deck__progress', agentId: 'a1', ...input })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({ prompt: 'Fix the page', description: 'Page fixes', subagentType: 'general-purpose' } as never)
  await progress({ steps: ['Read the page'], done: [0] })
  await progress({ ask: 'Add resolve button to failed rows', steps: ['Add the button'], current: 0 })
  await $.turn.complete({ agentId: 'a1', answer: 'Added it.', reason: 'answer' } as never)
  await clock.advance(2000)
  const a1 = snapshot<{ runs: Run[] }>().runs.find(r => r.id === 'a1')!
  expect(a1.asks!.map(a => [a.title, a.steps, a.finishedAt !== undefined])).toEqual([
    ['Page fixes', ['Read the page'], true],
    ['Add resolve button to failed rows', ['Add the button'], true],
  ])
})

test('the owner’s messages start asks on the main run; Haiku names them or drops chit-chat; the agent’s title wins', async ($, on) => {
  const replies: Record<string, string> = {
    'Please add a resolve button to the failed rows': '{"title": "Add resolve button to failed rows"}',
    'ok that looks good to me': '{"title": null}',
    'thanks': '{"title": null}',
  }
  let release: (() => void) | undefined
  let lateAnswered = false
  const { clock, snapshot } = setup(on, {
    modelComplete: async (_: unknown, e: { system?: string; prompt: string }) => {
      if (!String(e.system).includes('title what a user asked')) return { value: { isAnswered: false, text: '' } }
      const message = /<<<([\s\S]*)>>>/.exec(e.prompt)![1]!
      if (message.startsWith('Now make')) {
        await new Promise<void>(r => (release = r)) // answers late
        lateAnswered = true
      }
      return answer(replies[message] ?? '{"title": "Make the timeline bars thinner"}')
    },
  })
  const main = () => snapshot<{ runs: Run[] }>().runs.find(r => r.id === 'main')!
  const say = async (text: string) => {
    await $.prompt.submit({ text, wait: false } as never)
    await clock.advance(10)
  }
  const endTurn = () => $.turn.complete({ answer: 'Done.', reason: 'answer' } as never)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  await say('Please add a resolve button to the failed rows')
  await clock.advance(2000)
  expect(main().asks!.map(a => a.title)).toEqual(['Add resolve button to failed rows'])
  await endTurn()

  await say('ok that looks good to me') // 6 words: shown at once, then dropped
  await say('thanks') // under 4 words: never shown
  await clock.advance(2000)
  expect(main().asks!.map(a => a.title)).toEqual(['Add resolve button to failed rows'])
  expect(main().asks![0]!.finishedAt).toBeDefined()
  await endTurn()

  // The agent names the request before Haiku answers: its title replaces the message's, and Haiku's is ignored.
  await say('Now make the bars on the timeline a lot thinner')
  await callTool($, { tool: 'mcp__subagent-deck__progress', ask: 'Make timeline bars thinner', steps: ['Find the styles'] })
  expect(release).toBeDefined() // Haiku was asked and is still waiting
  release!()
  await clock.advance(2000)
  await clock.advance(2000)
  expect(lateAnswered).toBe(true)
  expect(main().asks!.map(a => a.title)).toEqual(['Add resolve button to failed rows', 'Make timeline bars thinner'])
})

test('with Haiku off, the message’s first 7 words title the ask and short messages are skipped', async ($, on) => {
  const { clock, snapshot } = setup(on, { env: { SUBAGENT_DECK_HAIKU: 'off' } })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'Please add a resolve button to every failed row on the page', wait: false } as never)
  await $.prompt.submit({ text: 'thanks a lot', wait: false } as never)
  await clock.advance(2000)
  const main = snapshot<{ runs: Run[] }>().runs.find(r => r.id === 'main')!
  expect(main.asks!.map(a => a.title)).toEqual(['Please add a resolve button to every'])
})
