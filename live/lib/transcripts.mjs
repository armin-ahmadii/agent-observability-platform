// Reading Claude Code's transcript files (~/.claude/projects/<project>/<session>.jsonl,
// with subagents under <session>/subagents/agent-<id>.jsonl).
import { closeSync, existsSync, fstatSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { StringDecoder } from 'node:string_decoder'
import { basename, join } from 'node:path'
import { PROJECTS_DIR } from './paths.mjs'

// Where a session's main transcript is. Found by scanning every project folder once, then remembered;
// a session not found yet is looked for again after MISS_RETRY_MS (its transcript may appear later).
const MISS_RETRY_MS = 10_000
const SUBAGENT_LIST_MS = 3_000 // subagent files are re-listed at most this often
const mainCache = new Map() // sessionId -> { path: string | null, at }
export function mainTranscript(sessionId) {
  const hit = mainCache.get(sessionId)
  if (hit?.path && existsSync(hit.path)) return hit.path
  if (hit && !hit.path && Date.now() - hit.at < MISS_RETRY_MS) return null
  let path = null
  try {
    for (const p of readdirSync(PROJECTS_DIR)) {
      const main = join(PROJECTS_DIR, p, `${sessionId}.jsonl`)
      if (existsSync(main)) { path = main; break }
    }
  } catch {}
  mainCache.set(sessionId, { path, at: Date.now() })
  return path
}

// A session's subagent transcripts (in <session>/subagents/, at any depth).
const subagentCache = new Map() // main path -> { at, files }
function subagentFiles(main) {
  const hit = subagentCache.get(main)
  if (hit && Date.now() - hit.at < SUBAGENT_LIST_MS) return hit.files
  const files = []
  const walk = d => {
    try {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const f = join(d, e.name)
        if (e.isDirectory()) walk(f)
        else if (e.name.endsWith('.jsonl')) files.push(f)
      }
    } catch {}
  }
  walk(join(main.replace(/\.jsonl$/, ''), 'subagents'))
  subagentCache.set(main, { at: Date.now(), files })
  return files
}

// A session's main transcript first, then its subagents' transcripts.
export function transcriptFiles(sessionId) {
  const main = mainTranscript(sessionId)
  return main ? [main, ...subagentFiles(main)] : []
}

export const isSubagentFile = path => path.includes('/subagents/')
export const agentIdOfFile = path => basename(path).replace(/^agent-/, '').replace(/\.jsonl$/, '')

// The complete lines of a file from byte `from`, read a few MB at a time (main transcripts can be hundreds of MB;
// reading one whole would hold several copies of it in memory). A last line without a newline counts only when it
// is already whole JSON (otherwise it is still being written). When done, `state.end` is the byte offset after the
// last line given, to continue from next time.
const LINE_CHUNK_BYTES = 4 << 20
export function* linesOf(path, from = 0, state = {}) {
  const fd = openSync(path, 'r')
  let pos = from, rest = ''
  try {
    const size = fstatSync(fd).size
    const buf = Buffer.alloc(Math.max(0, Math.min(LINE_CHUNK_BYTES, size - from)))
    const decoder = new StringDecoder('utf8') // keeps characters split across chunks whole
    while (pos < size) {
      const n = readSync(fd, buf, 0, Math.min(buf.length, size - pos), pos)
      if (n <= 0) break
      pos += n
      const lines = (rest + decoder.write(buf.subarray(0, n))).split('\n')
      rest = lines.pop()
      yield* lines
    }
  } finally { closeSync(fd) }
  state.end = pos
  if (rest) {
    try { JSON.parse(rest) } catch { state.end = pos - Buffer.byteLength(rest); return }
    yield rest
  }
}

// Calls onLine for each line from `from`; returns the offset to continue from.
export function forEachLine(path, onLine, from = 0) {
  const state = {}
  for (const line of linesOf(path, from, state)) onLine(line)
  return state.end ?? from
}

// Every billed reply in a transcript: message id -> { model, u: usage, at }.
// A reply can span several lines; the last one wins. Only the bytes added since the last read are read.
const repliesCache = new Map() // path -> { offset, byMsg }
export function readReplies(path) {
  const size = statSync(path).size
  let hit = repliesCache.get(path)
  if (!hit || size < hit.offset) repliesCache.set(path, hit = { offset: 0, byMsg: new Map() })
  if (size > hit.offset) hit.offset = forEachLine(path, line => addReply(hit.byMsg, line), hit.offset)
  return hit.byMsg
}

// Adds a line's billed reply (if it is one) to `byMsg`.
export function addReply(byMsg, line) {
  if (!line.includes('"usage"')) return
  const reply = parseReply(line)
  if (reply) byMsg.set(reply.id, reply)
}

// One transcript line as a billed reply, or null.
export function parseReply(line) {
  let d
  try { d = JSON.parse(line) } catch { return null }
  const m = d.message
  if (!m?.usage || !m.model || m.model === '<synthetic>') return null
  return { id: m.id ?? d.uuid, model: m.model, u: m.usage, at: Date.parse(d.timestamp) || 0 }
}

// The last model a session's transcript used (for older session files that never recorded one).
const MODEL_SCAN_BYTES = 400_000
const lastModelCache = new Map()
export function lastModelOf(sessionId) {
  if (lastModelCache.has(sessionId)) return lastModelCache.get(sessionId)
  let model
  const main = mainTranscript(sessionId)
  if (main) {
    try {
      const all = [...readTail(main, MODEL_SCAN_BYTES).matchAll(/"model":"(claude-[^"]+)"/g)]
      model = all.at(-1)?.[1]
    } catch {}
  }
  lastModelCache.set(sessionId, model)
  return model
}

// The last `bytes` of a file as text (the first character may be cut).
function readTail(path, bytes) {
  const fd = openSync(path, 'r')
  try {
    const size = fstatSync(fd).size
    const buf = Buffer.alloc(Math.min(bytes, size))
    readSync(fd, buf, 0, buf.length, size - buf.length)
    return buf.toString('utf8')
  } finally { closeSync(fd) }
}

// A message's text without the tags the app adds around it.
export function cleanText(t) {
  return String(t ?? '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<t3_context[\s\S]*?<\/t3_context>/g, '')
    .replace(/<(local-command-[a-z]+|command-[a-z]+)>[\s\S]*?<\/\1>/g, '')
    .replace(/\[Attached image[^\]]*\]|\[Image:[^\]]*\]/g, '[image]')
    .trim()
}

// The text blocks of a message's content (a string or a list of blocks), joined.
export const contentText = (content, sep) =>
  typeof content === 'string' ? content : Array.isArray(content) ? content.filter(b => b.type === 'text').map(b => b.text).join(sep) : ''

// An agent's answer without the notebook it may append.
export const stripNotebook = text => (String(text).split('NOTEBOOK:')[0] ?? '')

// "mcp__claude_ai_Figma__get_screenshot" -> "Figma" (the same spelling as the mod's server names).
export function mcpServerOf(tool) {
  const m = /^mcp__(.+?)__/.exec(tool)
  if (!m) return undefined
  const raw = m[1].replace(/^claude_ai_/, '').replace(/^plugin_[^_]+_/, '')
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}
