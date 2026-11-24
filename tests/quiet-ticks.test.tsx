import { expect, test } from 'claude-code/testing'

import { setup } from './harness'

test('a quiet session rewrites its file only as a heartbeat, and an unchanged inbox is not re-read', async ($, on) => {
  const { files, clock, fileEnding, snapshot, reads, writes } = setup(on, {})
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(2000)
  const path = fileEnding('/sessions/s1.json')!
  const inbox = path.replace(/sessions\/s1\.json$/, 'inbox.jsonl')
  // Another session's press sits in the inbox.
  files[inbox] = JSON.stringify({ sessionId: 'other', kind: 'toggle', name: 'x' }) + '\n'
  await clock.advance(2000)
  const before = { file: writes[path]!, inbox: reads[inbox] ?? 0, at: snapshot<{ updatedAt: number }>().updatedAt }

  // 12s with nothing happening: a write every 6s (the server needs one within 10s), and no inbox reads.
  for (let i = 0; i < 6; i++) await clock.advance(2000)
  expect(writes[path]! - before.file).toBe(2)
  expect(snapshot<{ updatedAt: number }>().updatedAt).toBeGreaterThan(before.at)
  expect((reads[inbox] ?? 0) - before.inbox).toBe(0)
  expect(files[inbox]).toContain('"other"')

  // Something changes: written on the next tick.
  const n = writes[path]!
  await $.agent.spawn({ prompt: 'Build the page', description: 'Page', subagentType: 'general-purpose' } as never)
  await clock.advance(2000)
  expect(writes[path]).toBe(n + 1)
  expect(snapshot<{ runs: { id: string }[] }>().runs.some(r => r.id === 'a1')).toBe(true)

  // A new press for this session is still picked up.
  files[inbox] += JSON.stringify({ sessionId: 's1', kind: 'toggle', name: 'nobody' }) + '\n'
  await clock.advance(2000)
  expect(files[inbox]).toBe(JSON.stringify({ sessionId: 'other', kind: 'toggle', name: 'x' }) + '\n')
})
