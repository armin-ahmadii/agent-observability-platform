// MCP servers: which server a tool belongs to, the server registry in
// live/servers.json (your entries, then Haiku's), and sorting new servers.
import type { ServerInfo, ServerKind } from '../types'
import { askHaiku } from './haiku'
import { type $, isHaikuOn, readLiveJson, writeLiveJson } from './state'
import { jsonObjectIn } from './text'

const REGISTRY_FILE = 'servers.json'
const KINDS: ServerKind[] = ['design', 'research', 'build', 'run']
const FALLBACK_COLOR = '#64748B'
/** Tool names sent to Haiku when sorting a server. */
const MAX_SAMPLE_TOOLS = 20

/** The registry as last read; reloaded on a timer by the session. */
export let registry: Record<string, ServerInfo> = {}

/** "mcp__claude_ai_Mobbin__search_screens" → "Mobbin". */
export function serverOf(tool: string): string | undefined {
  const match = /^mcp__(.+?)__/.exec(tool)
  if (!match?.[1]) return undefined
  const raw = match[1].replace(/^claude_ai_/, '').replace(/^plugin_[^_]+_/, '')
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

export async function loadRegistry($: $) {
  const next = await readLiveJson<Record<string, ServerInfo> | null>($, REGISTRY_FILE, null)
  if (next) registry = next // on a broken file, keep the last good copy
}

const seenTools = new Map<string, Set<string>>()
const sorting = new Set<string>()

/** Remember a tool call; the first call to an unknown server asks Haiku to sort it. */
export function noteServerTool($: $, tool: string) {
  const server = serverOf(tool)
  if (!server) return
  const names = seenTools.get(server) ?? new Set<string>()
  names.add(tool.replace(/^mcp__.+?__/, ''))
  seenTools.set(server, names)
  // With Haiku off, an unknown server keeps no entry: the page shows its own name and a colour from it.
  if (!registry[server] && isHaikuOn()) void sortServer($, server)
}

// Haiku names and sorts an unknown server once; the answer is saved to
// servers.json for every later session. Your own entries are never touched.
async function sortServer($: $, server: string) {
  if (registry[server] || sorting.has(server)) return
  sorting.add(server)
  try {
    const tools = [...(seenTools.get(server) ?? [])].slice(0, MAX_SAMPLE_TOOLS)
    const result = await askHaiku(
      $,
      { doing: `Sorting the ${server} server`, done: `Sorted the ${server} server` },
      {
        maxTokens: 200,
        system: 'You label MCP servers for a dashboard. Reply with one JSON object only.',
        prompt: `MCP server "${server}" has these tools: ${tools.join(', ') || '(none seen yet)'}.\nReply as {"label": "<short product name>", "kind": "design" | "research" | "build" | "run", "color": "<#RRGGBB brand-like colour>"}. kind: design = edits visual designs, research = looks things up or reads references, build = writes code or files, run = anything else.`,
      },
    )
    if (!result.isAnswered) return
    const guess = jsonObjectIn<Partial<ServerInfo>>(result.text) ?? {}
    const info: ServerInfo = {
      label: typeof guess.label === 'string' && guess.label.trim() ? guess.label.trim().slice(0, 40) : server,
      kind: KINDS.includes(guess.kind as ServerKind) ? (guess.kind as ServerKind) : 'run',
      color: typeof guess.color === 'string' && /^#[0-9a-f]{6}$/i.test(guess.color) ? guess.color : FALLBACK_COLOR,
      source: 'triage',
    }
    await loadRegistry($)
    if (registry[server]) return
    registry = { ...registry, [server]: info }
    await writeLiveJson($, REGISTRY_FILE, registry, 2)
  } catch {
    // try again next time this server is used
  } finally {
    sorting.delete(server)
  }
}
