// A minimal WebSocket server side (RFC 6455), no dependencies: the upgrade handshake, unmasked text frames out,
// and client frames read only to answer ping and close. Used for live change notices, which unlike a long-lived
// HTTP response don't take one of the browser's 6 connections per site.
import { createHash } from 'node:crypto'

const HANDSHAKE_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const OP = { text: 0x1, close: 0x8, ping: 0x9, pong: 0xa }
const MAX_CLIENT_FRAME_BYTES = 64 * 1024 // clients only send control frames here; anything bigger is closed
const CLOSE_TOO_BIG = 1009

export const acceptKey = key => createHash('sha1').update(key + HANDSHAKE_GUID).digest('base64')

// One unmasked server frame (FIN set).
export function frame(opcode, payload = Buffer.alloc(0)) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload))
  const n = data.length
  const head = n < 126 ? Buffer.from([0x80 | opcode, n])
    : n < 65536 ? Buffer.from([0x80 | opcode, 126, n >> 8, n & 0xff])
    : Buffer.concat([Buffer.from([0x80 | opcode, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b })()])
  return Buffer.concat([head, data])
}

// Parses whole frames from the front of `buf`. Returns { frames: [{ opcode, payload }], rest } or { tooBig: true }.
export function parseFrames(buf) {
  const frames = []
  let at = 0
  while (buf.length - at >= 2) {
    const opcode = buf[at] & 0x0f
    const masked = (buf[at + 1] & 0x80) !== 0
    let len = buf[at + 1] & 0x7f, pos = at + 2
    if (len === 126) { if (buf.length - pos < 2) break; len = buf.readUInt16BE(pos); pos += 2 }
    else if (len === 127) { if (buf.length - pos < 8) break; const big = buf.readBigUInt64BE(pos); if (big > BigInt(MAX_CLIENT_FRAME_BYTES)) return { tooBig: true }; len = Number(big); pos += 8 }
    if (len > MAX_CLIENT_FRAME_BYTES) return { tooBig: true }
    const maskAt = pos
    if (masked) pos += 4
    if (buf.length - pos < len) break
    const payload = Buffer.from(buf.subarray(pos, pos + len))
    if (masked) for (let i = 0; i < len; i++) payload[i] ^= buf[maskAt + (i % 4)]
    frames.push({ opcode, payload })
    at = pos + len
  }
  return { frames, rest: buf.subarray(at) }
}

// Refuses an upgrade with a plain HTTP response.
export function refuseUpgrade(socket, status, reason, headers = {}) {
  const extra = Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`).join('')
  socket.end(`HTTP/1.1 ${status} ${reason}\r\ncontent-type: text/plain\r\nconnection: close\r\n${extra}content-length: ${Buffer.byteLength(reason)}\r\n\r\n${reason}`)
}

// Completes the handshake on an upgrade request. Returns a connection { send(text), close(), onClose(fn) },
// or null after refusing a request that isn't a valid WebSocket upgrade.
export function acceptWebSocket(req, socket) {
  const key = req.headers['sec-websocket-key']
  if (String(req.headers.upgrade ?? '').toLowerCase() !== 'websocket' || !key || req.headers['sec-websocket-version'] !== '13') {
    refuseUpgrade(socket, 400, 'Bad Request')
    return null
  }
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`)
  socket.setNoDelay(true)
  let closed = false
  const closeHandlers = []
  const finish = () => {
    if (closed) return
    closed = true
    for (const fn of closeHandlers) fn()
  }
  const write = buf => { if (!closed && socket.writable) socket.write(buf) }
  const close = (code = 1000) => {
    if (closed) return
    const b = Buffer.alloc(2); b.writeUInt16BE(code)
    write(frame(OP.close, b))
    socket.end()
    finish()
  }
  let pending = Buffer.alloc(0)
  socket.on('data', chunk => {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk
    const parsed = parseFrames(pending)
    if (parsed.tooBig) return close(CLOSE_TOO_BIG)
    pending = parsed.rest
    for (const f of parsed.frames) {
      if (f.opcode === OP.ping) write(frame(OP.pong, f.payload))
      else if (f.opcode === OP.close) { write(frame(OP.close, f.payload.subarray(0, 2))); socket.end(); finish() }
      // text, binary and pong frames from the page are ignored
    }
  })
  socket.on('close', finish)
  socket.on('error', finish)
  return {
    send: text => write(frame(OP.text, text)),
    ping: () => write(frame(OP.ping)),
    close,
    onClose: fn => closeHandlers.push(fn),
  }
}
