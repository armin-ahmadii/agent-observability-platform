import { expect, test } from 'claude-code/testing'

import { liveDirFor } from '../hooks/live-dir'
import { setup } from './harness'

test('the live folder: override, then a dev copy’s source, then beside the plugin', () => {
  expect(liveDirFor('/home/u/.claude/mods/subagent-deck')).toBe('/home/u/.claude/mods/subagent-deck/live')
  expect(liveDirFor('/home/u/.claude/dev-mods/abc-123/subagent-deck')).toBe('/home/u/.claude/mods/subagent-deck/live')
  expect(liveDirFor('/home/u/.claude/plugins/cache/market/subagent-deck/0.1.0')).toBe('/home/u/.claude/plugins/cache/market/subagent-deck/0.1.0/live')
  expect(liveDirFor('/opt/code/subagent-deck/')).toBe('/opt/code/subagent-deck/live')
  expect(liveDirFor('/opt/code/subagent-deck', ' /data/deck/ ')).toBe('/data/deck')
  expect(liveDirFor('/opt/code/subagent-deck', '  ')).toBe('/opt/code/subagent-deck/live')
  expect(liveDirFor('', undefined, '/home/u')).toBe('/home/u/.claude/mods/subagent-deck/live')
})

test('SUBAGENT_DECK_LIVE moves every file the mod writes', async ($, on) => {
  const { files, clock } = setup(on, { env: { SUBAGENT_DECK_LIVE: '/data/deck' } })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(2000)
  expect(Object.keys(files)).toContain('/data/deck/sessions/s1.json')
  expect(Object.keys(files).every(p => p.startsWith('/data/deck/'))).toBe(true)
})
