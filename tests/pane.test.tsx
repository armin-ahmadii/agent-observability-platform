import { expect, test } from 'claude-code/testing'

import { callTool, setup } from './harness'

const PANE = {
  plugin: 'subagent-deck',
  component: 'Pane',
  requestId: 'subagents',
  props: {
    title: 'Subagents',
    isFocused: false,
    bodyColumns: 90,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

test('a subagent shows its name, activity and servers on every surface', async ($, on) => {
  setup(on, { spawned: { model: 'claude-sonnet-5-5', agentId: 'a1' }, usd: 0.42 })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({ prompt: 'Design the empty state', description: 'Design empty state', subagentType: 'general-purpose' } as never)
  await callTool($, { tool: 'mcp__paper__write_html', agentId: 'a1' })
  await callTool($, { tool: 'mcp__claude_ai_Mobbin__search_screens', agentId: 'a1' })
  await callTool($, { tool: 'mcp__paper__get_basic_info' })

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    for (const bodyColumns of [90, 40]) {
      const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns }, surface })
      expect((await ui.find({ type: 'Text', text: /Design empty state/ }))?.text).toContain('Design empty state')
      expect(await ui.find({ type: 'Text', text: /Researching in Mobbin/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /Paper ×2/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /Main conversation/ })).toBeDefined()
      await ui.unmount()
    }
  }
})

test('an open pane redraws when a run changes, without waiting for the tick', async ($, on) => {
  setup(on, {})
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({ prompt: 'Design the empty state', description: 'Design empty state', subagentType: 'general-purpose' } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Figma ×1/ })).toBeUndefined()
  await callTool($, { tool: 'mcp__figma__get_design', agentId: 'a1' })
  expect(await ui.find({ type: 'Text', text: /Figma ×1/ })).toBeDefined()
  await ui.unmount()
})
