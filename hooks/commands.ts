// Slash commands: open the pane, and manage saved helpers.
import type { On } from 'claude-code'

import { registerHelper, saveHelpers } from './helpers'
import { PANE, PANE_TITLE } from './pane'
import { type $, updateRuns, getHelpers } from './state'
import { slug } from './text'

export async function registerCommands($: $) {
  await $.command.register({ name: 'subagents', description: 'Open the subagent panel' })
  await $.command.register({ name: 'swarm', description: 'Group saved helpers into a swarm', argumentHint: '<swarm-name> <helper> [helper…]' })
  await $.command.register({ name: 'rename-helper', description: 'Rename a saved helper', argumentHint: '<old-name> <new-name>' })
  await $.command.register({ name: 'forget-helper', description: 'Delete a saved helper', argumentHint: '<name>' })
}

export function answerCommands(on: On) {
  on('command.run', { command: 'subagents' }, async $ => {
    await $.ui.open({ id: PANE, title: PANE_TITLE })
    return { text: 'Subagent panel opened.' }
  })

  on('command.run', { command: 'swarm' }, async ($, e) => {
    const [swarm, ...names] = e.args.trim().split(/\s+/).filter(Boolean)
    if (!swarm || names.length === 0) return { text: 'Usage: /swarm <swarm-name> <helper> [helper…]' }
    const known = new Set((await getHelpers($)).map(h => h.name))
    const missing = names.filter(n => !known.has(n))
    const list = await saveHelpers($, all => all.map(h => (names.includes(h.name) ? { ...h, swarm } : h)))
    for (const h of list) if (names.includes(h.name)) await registerHelper($, h)
    const added = names.filter(n => known.has(n))
    return {
      text: `Swarm "${swarm}": ${added.join(', ') || 'no helpers added'}.` + (missing.length ? ` Not found: ${missing.join(', ')}.` : ''),
    }
  })

  on('command.run', { command: 'rename-helper' }, async ($, e) => {
    const [from, to] = e.args.trim().split(/\s+/)
    if (!from || !to) return { text: 'Usage: /rename-helper <old-name> <new-name>' }
    const name = slug(to)
    const all = await getHelpers($)
    if (!all.some(h => h.name === from)) return { text: `No saved helper named "${from}".` }
    if (all.some(h => h.name === name)) return { text: `"${name}" is already taken.` }
    const list = await saveHelpers($, l => l.map(h => (h.name === from ? { ...h, name } : h)))
    const helper = list.find(h => h.name === name)
    if (helper) await registerHelper($, helper)
    await updateRuns($, l => l.map(r => (r.savedAs === from ? { ...r, savedAs: name } : r)))
    return { text: `Renamed "${from}" to "${name}".` }
  })

  on('command.run', { command: 'forget-helper' }, async ($, e) => {
    const name = e.args.trim()
    const all = await getHelpers($)
    if (!all.some(h => h.name === name)) return { text: `No saved helper named "${name}".` }
    await saveHelpers($, l => l.filter(h => h.name !== name))
    return { text: `Forgot "${name}".` }
  })
}
