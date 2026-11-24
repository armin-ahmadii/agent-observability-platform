import { expect, test } from 'claude-code/testing'

import { answer, setup } from './harness'

test('finished agents get a done-list once, live or asked for by the page', async ($, on) => {
  const doneCalls: string[] = []
  const { files, clock, fileEnding } = setup(on, {
    modelComplete: (_: unknown, e: { system?: string; prompt: string }) => {
      if (!String(e.system ?? '').includes('actually completed')) return { value: { isAnswered: false, text: '' } }
      doneCalls.push(e.prompt)
      return answer('["Add the done field", "Write the test"]')
    },
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({ prompt: 'Add a done field to the mod data', description: 'Mod done field', subagentType: 'general-purpose' } as never)
  await $.turn.complete({ agentId: 'a1', answer: 'Added the done field and wrote a test. Did NOT restart the server.', reason: 'answer' } as never)
  await clock.advance(10)

  const live = fileEnding('/live/done.json')!
  const dir = live.replace(/done\.json$/, '')
  expect(JSON.parse(files[live]!).a1.items).toEqual(['Add the done field', 'Write the test'])

  // The page asks for an earlier agent, twice, plus a1 again: Haiku runs once more only.
  const ask = { sessionId: 's1', kind: 'done', items: [{ id: 'old-1', label: 'Old agent', brief: 'Fix the tooltip', result: 'Fixed the tooltip overlap.' }, { id: 'a1', label: 'Mod done field', brief: 'x', result: 'y' }] }
  files[`${dir}inbox.jsonl`] = JSON.stringify(ask) + '\n' + JSON.stringify(ask) + '\n'
  await clock.advance(2000)
  await clock.advance(2000)
  expect(doneCalls.length).toBe(2)
  expect(Object.keys(JSON.parse(files[live]!)).sort()).toEqual(['a1', 'old-1'])

  const snap = JSON.parse(files[`${dir}sessions/s1.json`]!) as { runs: { id: string; done?: string[] }[] }
  expect(snap.runs.find(r => r.id === 'a1')!.done).toEqual(['Add the done field', 'Write the test'])
})
