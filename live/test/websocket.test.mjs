import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { acceptKey, frame, parseFrames } from '../lib/websocket.mjs'

const tick = ms => new Promise(r => setTimeout(r, ms))

test('handshake key (RFC 6455 example)', () => {
  assert.equal(acceptKey('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=')
})

test('frames: server text out, masked client frames in', () => {
  const short = frame(0x1, 'hi')
  assert.deepEqual([...short.subarray(0, 2)], [0x81, 2])
  assert.deepEqual([...frame(0x1, 'x'.repeat(300)).subarray(0, 4)], [0x81, 126, 1, 44])
  const mask = [1, 2, 3, 4], payload = Buffer.from('ping!')
  const masked = Buffer.concat([Buffer.from([0x89, 0x80 | payload.length, ...mask]), Buffer.from(payload.map((b, i) => b ^ mask[i % 4]))])
  const { frames, rest } = parseFrames(Buffer.concat([masked, masked.subarray(0, 3)])) // one whole frame, one partial
  assert.equal(frames.length, 1)
  assert.equal(frames[0].opcode, 0x9)
  assert.equal(frames[0].payload.toString(), 'ping!')
  assert.equal(rest.length, 3)
  assert.equal(parseFrames(Buffer.from([0x81, 127, 0, 0, 0, 0, 1, 0, 0, 0])).tooBig, true)
})

// The real server, on a spare port, with an empty home and live folder.
const port = 4700 + Math.floor(Math.random() * 80)
const home = mkdtempSync(join(tmpdir(), 'deck-ws-'))
const live = join(home, 'live')
mkdirSync(join(live, 'sessions'), { recursive: true })
let server
before(async () => {
  server = spawn(process.execPath, [new URL('../server.mjs', import.meta.url).pathname, '--port', String(port), '--live', live], { env: { ...process.env, HOME: home }, stdio: 'ignore' })
  for (let i = 0; i < 100; i++) { try { await fetch(`http://localhost:${port}/api/build`); return } catch { await tick(50) } }
  throw new Error('server did not start')
})
after(() => server.kill())

// Opens a WebSocket with the built-in client; collects its messages.
function openWs(view = 'all', headers) {
  const ws = new WebSocket(`ws://localhost:${port}/api/ws?id=${view}`, headers ? { headers } : undefined)
  const messages = []
  ws.addEventListener('message', e => messages.push(JSON.parse(e.data)))
  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve({ ws, messages }))
    ws.addEventListener('error', reject)
  })
}

// A raw upgrade request; resolves with the server's status line.
function rawUpgrade(headers) {
  return new Promise(resolve => {
    const s = connect(port, '127.0.0.1', () => s.write(`GET /api/ws?id=all HTTP/1.1\r\n${Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`))
    s.once('data', d => { resolve(d.toString().split('\r\n')[0]); s.destroy() })
  })
}
const upgradeHeaders = extra => ({ host: `localhost:${port}`, upgrade: 'websocket', connection: 'Upgrade', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', 'sec-websocket-version': '13', ...extra })

test('the handshake, and the same Host/Origin guard as other requests', async () => {
  assert.equal(await rawUpgrade(upgradeHeaders()), 'HTTP/1.1 101 Switching Protocols')
  assert.equal(await rawUpgrade(upgradeHeaders({ origin: `http://localhost:${port}` })), 'HTTP/1.1 101 Switching Protocols')
  assert.match(await rawUpgrade(upgradeHeaders({ host: `evil.example:${port}` })), /^HTTP\/1.1 421/)
  assert.match(await rawUpgrade(upgradeHeaders({ origin: 'http://evil.example' })), /^HTTP\/1.1 403/)
  assert.match(await rawUpgrade(upgradeHeaders({ 'sec-websocket-version': '8' })), /^HTTP\/1.1 400/)
})

test('a change to a session file arrives as {"type":"change","ids":[...]}', async () => {
  const { ws, messages } = await openWs('all')
  await tick(100)
  assert.deepEqual(messages[0], { type: 'hello', view: 'all' })
  const t = Date.now()
  writeFileSync(join(live, 'sessions', 'w1.json'), JSON.stringify({ sessionId: 'w1', runs: [] }))
  while (messages.length < 2 && Date.now() - t < 2000) await tick(5)
  assert.deepEqual(messages[1], { type: 'change', ids: ['w1'] })
  assert.ok(Date.now() - t < 400, `took ${Date.now() - t} ms`)
  ws.close()
})

test('a session view only hears about its own file', async () => {
  const a = await openWs('w2'), b = await openWs('w3')
  await tick(100)
  writeFileSync(join(live, 'sessions', 'w2.json'), JSON.stringify({ sessionId: 'w2', runs: [] }))
  await tick(300)
  assert.deepEqual(a.messages.filter(m => m.type === 'change'), [{ type: 'change', ids: ['w2'] }])
  assert.deepEqual(b.messages.filter(m => m.type === 'change'), [])
  a.ws.close(); b.ws.close()
})

test('8 sockets open at once, and normal requests still answer fast', async () => {
  const sockets = await Promise.all(Array.from({ length: 8 }, () => openWs('all')))
  await tick(100)
  const t = performance.now()
  const res = await fetch(`http://localhost:${port}/api/session?id=all&win=24h`)
  assert.equal(res.status, 200)
  await res.json()
  assert.ok(performance.now() - t < 500, `took ${performance.now() - t} ms`)
  writeFileSync(join(live, 'sessions', 'w4.json'), JSON.stringify({ sessionId: 'w4', runs: [] }))
  await tick(300)
  for (const s of sockets) assert.ok(s.messages.some(m => m.type === 'change' && m.ids.includes('w4')))
  for (const s of sockets) s.ws.close()
})

test('the server answers a ping and a close', async () => {
  const s = connect(port, '127.0.0.1')
  await new Promise(r => s.once('connect', r))
  s.write(`GET /api/ws?id=all HTTP/1.1\r\n${Object.entries(upgradeHeaders()).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`)
  let got = Buffer.alloc(0)
  s.on('data', d => { got = Buffer.concat([got, d]) })
  await tick(150)
  const masked = (op, body) => { const m = [9, 8, 7, 6], b = Buffer.from(body); return Buffer.concat([Buffer.from([0x80 | op, 0x80 | b.length, ...m]), Buffer.from(b.map((x, i) => x ^ m[i % 4]))]) }
  got = Buffer.alloc(0)
  s.write(masked(0x9, 'hey'))
  await tick(100)
  const pong = parseFrames(got).frames
  assert.equal(pong[0].opcode, 0xa)
  assert.equal(pong[0].payload.toString(), 'hey')
  got = Buffer.alloc(0)
  const closed = new Promise(r => s.once('close', r))
  s.write(masked(0x8, Buffer.from([0x03, 0xe8])))
  await closed
  assert.equal(parseFrames(got).frames[0].opcode, 0x8)
})

test('pages asking at once share one answer; a change shows in the very next one', async () => {
  const { ws, messages } = await openWs('all')
  await tick(100)
  const all = () => fetch(`http://localhost:${port}/api/session?id=all&win=24h`)
  const [a, b] = await Promise.all([all(), all()])
  assert.equal(a.headers.get('etag'), b.headers.get('etag'))
  await Promise.all([a.text(), b.text()])
  writeFileSync(join(live, 'sessions', 'w9.json'), JSON.stringify({ sessionId: 'w9', runs: [{ id: 'main', now: 'running', startedAt: 1 }], recentAsks: [{ at: 1, text: 'hello', routedTo: [] }] }))
  const t = Date.now()
  while (!messages.some(m => m.type === 'change' && m.ids.includes('w9')) && Date.now() - t < 2000) await tick(5)
  const snap = await (await all()).json()
  assert.equal(snap.recentAsks?.w9?.[0]?.text, 'hello')
  ws.close()
})
