// A session's earlier work, rebuilt from its transcripts: every subagent it ran, and every MCP server it called.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ACTIVITY_LABEL, activityOf } from './activity.mjs'
import { replyTokens, replyUsd } from './pricing.mjs'
import { agentIdOfFile, isSubagentFile, mcpServerOf, readLines, readReplies, stripNotebook, transcriptFiles } from './transcripts.mjs'

const TEXT_CHARS = 4000
const MAX_SEGMENTS = 300
const THINKING_GAP_MS = 500 // a pause longer than this between a tool result and the next step is thinking
const MERGE_GAP_MS = 3000 // same-kind tool calls closer than this share one timeline segment

// Every subagent this session ran: name, model, when, cost and tokens, brief, answer and timeline.
const historyCache = new Map()
export function sessionHistory(sessionId) {
  const [main] = transcriptFiles(sessionId)
  if (!main) return []
  const dir = join(main.replace(/\.jsonl$/, ''), 'subagents')
  let names = []
  try { names = readdirSync(dir).filter(n => n.endsWith('.jsonl')) } catch { return [] }
  const out = []
  for (const n of names) {
    const path = join(dir, n)
    const st = statSync(path)
    const hit = historyCache.get(path)
    if (hit && hit.size === st.size) { out.push(hit.row); continue }
    const row = subagentRow(path, st)
    historyCache.set(path, { size: st.size, row })
    out.push(row)
  }
  return out.sort((a, b) => b.startedAt - a.startedAt)
}

function subagentRow(path, st) {
  let meta = {}
  try { meta = JSON.parse(readFileSync(path.replace(/\.jsonl$/, '.meta.json'), 'utf8')) } catch {}
  let start = Infinity, end = 0, usd = 0, tokens = 0, model = null
  for (const { model: m, u, at } of readReplies(path).values()) {
    model = m
    if (at) { start = Math.min(start, at); end = Math.max(end, at) }
    usd += replyUsd(m, u)
    tokens += replyTokens(u)
  }
  if (start === Infinity) start = st.birthtimeMs
  const { brief, result, segments, errors } = readTrace(path)
  return { id: agentIdOfFile(path), label: meta.description || meta.agentType || 'Agent', type: meta.agentType, model, startedAt: start, endedAt: end || st.mtimeMs, usd, tokens, brief, result, segments, errors }
}

// What an agent was asked, what it answered, and a timeline of its tool calls (same segment shape as the mod's).
export function readTrace(path) {
  let brief = '', result = '', errors = 0
  const segments = []
  const open = new Map() // tool_use id -> its segment
  let lastResultAt = 0
  for (const line of readLines(path)) {
    if (!line) continue
    let d
    try { d = JSON.parse(line) } catch { continue }
    const at = Date.parse(d.timestamp) || 0
    const content = d.message?.content
    if (d.type === 'user') {
      if (!brief) brief = typeof content === 'string' ? content : (content?.find?.(c => c.type === 'text')?.text ?? '')
      for (const c of Array.isArray(content) ? content : []) {
        if (c.type !== 'tool_result') continue
        if (c.is_error) errors++
        const seg = open.get(c.tool_use_id)
        if (seg) { seg.end = Math.max(seg.start + 1, at); open.delete(c.tool_use_id) }
        lastResultAt = Math.max(lastResultAt, at)
      }
    } else if (d.type === 'assistant' && Array.isArray(content)) {
      if (lastResultAt && at - lastResultAt > THINKING_GAP_MS && open.size === 0) {
        segments.push({ act: 'thinking', key: 'thinking', label: 'Thinking', start: lastResultAt, end: at, tokensAtStart: 0, tokens: 0 })
        lastResultAt = 0
      }
      for (const c of content) {
        if (c.type === 'text' && c.text?.trim()) result = c.text
        if (c.type !== 'tool_use') continue
        const server = mcpServerOf(c.name)
        const act = activityOf(c.name)
        const key = server ? `${server}:${act}` : act
        const last = segments[segments.length - 1]
        if (last && last.key === key && at - last.end < MERGE_GAP_MS) { open.set(c.id, last); continue }
        const seg = { act, key, label: server ?? ACTIVITY_LABEL[act], server, start: at, end: at + 1, tokensAtStart: 0, tokens: 0 }
        segments.push(seg)
        open.set(c.id, seg)
      }
    }
  }
  return {
    brief: brief.slice(0, TEXT_CHARS),
    result: stripNotebook(result).trim().slice(0, TEXT_CHARS),
    segments: segments.slice(-MAX_SEGMENTS),
    errors,
  }
}

// Every MCP server this session (and its subagents) called: calls, tools used, first and last use, which agents.
const mcpCache = new Map()
function mcpCallsOf(path) {
  const st = statSync(path)
  const hit = mcpCache.get(path)
  if (hit && hit.size === st.size) return hit.calls
  const calls = []
  for (const line of readLines(path)) {
    if (!line.includes('"mcp__')) continue
    try {
      const d = JSON.parse(line)
      if (d.type !== 'assistant') continue
      for (const c of d.message?.content ?? []) {
        if (c.type !== 'tool_use' || !String(c.name).startsWith('mcp__')) continue
        calls.push({ server: mcpServerOf(c.name), tool: String(c.name).replace(/^mcp__.+?__/, ''), at: Date.parse(d.timestamp) || 0 })
      }
    } catch {}
  }
  mcpCache.set(path, { size: st.size, calls })
  return calls
}

export function sessionMcp(sessionId) {
  const per = {}
  for (const f of transcriptFiles(sessionId)) {
    const agent = isSubagentFile(f) ? agentIdOfFile(f) : 'main'
    for (const c of mcpCallsOf(f)) {
      const x = (per[c.server] ??= { server: c.server, calls: 0, tools: {}, firstAt: Infinity, lastAt: 0, agents: new Set() })
      x.calls++
      x.tools[c.tool] = (x.tools[c.tool] ?? 0) + 1
      x.firstAt = Math.min(x.firstAt, c.at)
      x.lastAt = Math.max(x.lastAt, c.at)
      x.agents.add(agent)
    }
  }
  return Object.values(per)
    .map(x => ({ ...x, agents: [...x.agents], tools: toolCounts(x.tools) }))
    .sort((a, b) => b.lastAt - a.lastAt)
}

// { name: count } -> [{ name, n }], most used first.
export const toolCounts = tools => Object.entries(tools).sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n }))
