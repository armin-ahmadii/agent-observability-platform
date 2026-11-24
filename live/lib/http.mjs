import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { livePath } from './paths.mjs'

const GZIP_MIN_BYTES = 64 * 1024 // smaller bodies aren't worth compressing on a local connection
const GZIP_LEVEL = 4 // most of the size win for a fraction of the default level's time

export function send(res, status, type, body) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(body)
}

// A JSON body ready to send: its text, ETag, and gzip copy (made on first use).
function prepare(text) {
  return { text, etag: '"' + createHash('sha1').update(text).digest('base64url').slice(0, 22) + '"', gz: null }
}

// JSON with an ETag, revalidated on every use ("no-cache"): a browser asking again with If-None-Match gets
// 304 and reuses its copy, which fetch() returns as a normal 200. Large bodies go gzipped when accepted.
function sendPrepared(res, p) {
  const req = res.req
  const headers = { 'content-type': 'application/json', 'cache-control': 'no-cache', etag: p.etag, vary: 'accept-encoding' }
  if (req?.headers['if-none-match'] === p.etag) {
    res.writeHead(304, headers)
    return res.end()
  }
  if (p.text.length >= GZIP_MIN_BYTES && /\bgzip\b/.test(req?.headers['accept-encoding'] ?? '')) {
    p.gz ??= gzipSync(p.text, { level: GZIP_LEVEL })
    res.writeHead(200, { ...headers, 'content-encoding': 'gzip' })
    return res.end(p.gz)
  }
  res.writeHead(200, headers)
  res.end(p.text)
}

// Cached results (the same object until their data changes) are serialised, hashed and gzipped once.
const prepared = new WeakMap()
function preparedFor(value) {
  if (value === null || typeof value !== 'object') return prepare(JSON.stringify(value))
  let p = prepared.get(value)
  if (!p) prepared.set(value, p = prepare(JSON.stringify(value)))
  return p
}

// `value` must not change after it is sent (it may be reused by identity).
export const sendJson = (res, value) => sendPrepared(res, preparedFor(value))

// Runs `fn`; on any error sends `fallback` (already JSON text) instead.
export function sendJsonOr(res, fallback, fn) {
  let p
  try { p = preparedFor(fn()) } catch { p = prepare(fallback) }
  sendPrepared(res, p)
}

// A JSON store in the live folder, sent as it is ("{}" if missing). Re-read only when the file changed.
const stores = new Map() // name -> { mtimeMs, size, p }
export function sendStore(res, name) {
  let p
  try {
    const path = livePath(name)
    const st = statSync(path)
    const hit = stores.get(name)
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) p = hit.p
    else stores.set(name, { mtimeMs: st.mtimeMs, size: st.size, p: p = prepare(readFileSync(path, 'utf8')) })
  } catch { p = prepare('{}') }
  sendPrepared(res, p)
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
