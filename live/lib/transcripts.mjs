// Reading Claude Code's transcript files (~/.claude/projects/<project>/<session>.jsonl,
// with subagents under <session>/subagents/agent-<id>.jsonl).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { PROJECTS_DIR } from './paths.mjs'

// A session's main transcript first, then its subagents' transcripts.
export function transcriptFiles(sessionId) {
  const out = []
  let projects = []
  try { projects = readdirSync(PROJECTS_DIR) } catch { return out }
  for (const p of projects) {
    const main = join(PROJECTS_DIR, p, `${sessionId}.jsonl`)
    if (!existsSync(main)) continue
    out.push(main)
    const walk = d => {
      try {
        for (const n of readdirSync(d)) {
          const f = join(d, n)
          if (statSync(f).isDirectory()) walk(f)
          else if (n.endsWith('.jsonl')) out.push(f)
        }
      } catch {}
    }
    walk(join(PROJECTS_DIR, p, sessionId, 'subagents'))
    break
  }
  return out
}

export const isSubagentFile = path => path.includes('/subagents/')
export const agentIdOfFile = path => basename(path).replace(/^agent-/, '').replace(/\.jsonl$/, '')

export const readLines = path => readFileSync(path, 'utf8').split('\n')

// Every billed reply in a transcript: message id -> { model, u: usage, at }.
// A reply can span several lines; the last one wins. Re-read only when the file grows.
const repliesCache = new Map()
export function readReplies(path) {
  const st = statSync(path)
  const hit = repliesCache.get(path)
  if (hit && hit.size === st.size) return hit.byMsg
  const byMsg = new Map()
  for (const line of readLines(path)) {
    if (!line.includes('"usage"')) continue
    const reply = parseReply(line)
    if (reply) byMsg.set(reply.id, reply)
  }
  repliesCache.set(path, { size: st.size, byMsg })
  return byMsg
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
const MODEL_SCAN_CHARS = 400_000
const lastModelCache = new Map()
export function lastModelOf(sessionId) {
  if (lastModelCache.has(sessionId)) return lastModelCache.get(sessionId)
  let model
  const [main] = transcriptFiles(sessionId)
  if (main) {
    try {
      const all = [...readFileSync(main, 'utf8').slice(-MODEL_SCAN_CHARS).matchAll(/"model":"(claude-[^"]+)"/g)]
      model = all.at(-1)?.[1]
    } catch {}
  }
  lastModelCache.set(sessionId, model)
  return model
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
