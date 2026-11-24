import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseOptions } from '../lib/cli.mjs'

test('defaults to port 4791 and no folder', () => {
  assert.deepEqual(parseOptions([]), { port: 4791, liveDir: null })
})

test('flags', () => {
  assert.deepEqual(parseOptions(['--port', '4800', '--live', '/d']), { port: 4800, liveDir: '/d' })
  assert.deepEqual(parseOptions(['-p', '4800']), { port: 4800, liveDir: null })
})

test('positional form used by existing launchd jobs', () => {
  assert.deepEqual(parseOptions(['4800', '/d']), { port: 4800, liveDir: '/d' })
})

test('help', () => {
  assert.deepEqual(parseOptions(['--help']), { help: true })
  assert.deepEqual(parseOptions(['-h']), { help: true })
})

test('errors', () => {
  for (const args of [['abc'], ['--port', 'x'], ['--port', '70000'], ['--bogus'], ['1', '2', '3'], ['--port', '4800', '/d'], ['--live', '/d', '4800']]) {
    assert.ok(parseOptions(args).error, args.join(' '))
  }
})
