import { readFileSync } from 'node:fs'
import { livePath } from './paths.mjs'

export function send(res, status, type, body) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(body)
}

export const sendJson = (res, value) => send(res, 200, 'application/json', JSON.stringify(value))

// Runs `fn`; on any error sends `fallback` (already JSON text) instead.
export function sendJsonOr(res, fallback, fn) {
  let body
  try { body = JSON.stringify(fn()) } catch { body = fallback }
  send(res, 200, 'application/json', body)
}

// A JSON store in the live folder, sent as it is ("{}" if missing).
export function sendStore(res, name) {
  let body = '{}'
  try { body = readFileSync(livePath(name), 'utf8') } catch {}
  send(res, 200, 'application/json', body)
}

// The request body parsed as JSON (null when empty). Rejects with { status } when too large or not JSON.
export function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size > maxBytes) { req.pause(); reject({ status: 413 }); return } // the caller replies, then closes
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (!text.trim()) return resolve(null)
      try { resolve(JSON.parse(text)) } catch { reject({ status: 400 }) }
    })
    req.on('error', () => reject({ status: 400 }))
  })
}
