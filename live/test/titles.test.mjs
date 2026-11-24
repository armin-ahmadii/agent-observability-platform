import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// A fake home with one transcript; the modules find ~/.claude/projects from HOME when first imported.
const home = mkdtempSync(join(tmpdir(), 'deck-titles-'))
process.env.HOME = home
process.env.SUBAGENT_DECK_LIVE = join(home, 'live')
const dir = join(home, '.claude', 'projects', 'p')
mkdirSync(dir, { recursive: true })
const file = join(dir, 's1.jsonl')
const line = o => JSON.stringify(o) + '\n'
const { delegatedTitles, safeTranscriptTitle } = await import('../lib/titles.mjs')

test('titles follow a growing transcript, read in pieces', () => {
  writeFileSync(file, line({ type: 'user', message: { content: 'Fix the login page please' } }))
  assert.equal(safeTranscriptTitle('s1'), 'Fix the login page please')

  const ai = line({ type: 'ai-title', aiTitle: 'Login fix' })
  appendFileSync(file, ai.slice(0, 10)) // half-written line: not parsed yet
  assert.equal(safeTranscriptTitle('s1'), 'Fix the login page please')
  appendFileSync(file, ai.slice(10))
  assert.equal(safeTranscriptTitle('s1'), 'Login fix')

  appendFileSync(file, line({ type: 'custom-title', customTitle: 'Mine' }) + line({ type: 'ai-title', aiTitle: 'Later AI title' }))
  assert.equal(safeTranscriptTitle('s1'), 'Mine') // a title you set wins over later AI titles
})

test('tasks handed to T3 helpers are collected', () => {
  appendFileSync(file, line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__t3-code__delegate_task', input: { title: 'Build it' } }] } }))
  assert.deepEqual(delegatedTitles('s1'), ['Build it'])
})

test('a rewritten (shorter) file is read again from the start', () => {
  writeFileSync(file, line({ type: 'ai-title', aiTitle: 'Fresh' }))
  assert.equal(safeTranscriptTitle('s1'), 'Fresh')
  assert.deepEqual(delegatedTitles('s1'), [])
})
