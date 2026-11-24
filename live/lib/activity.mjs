// The kind of work a tool call is, with the same names as the mod's own activityOf (hooks/).
import { readFileSync } from 'node:fs'
import { livePath } from './paths.mjs'
import { SECOND } from './time.mjs'
import { mcpServerOf } from './transcripts.mjs'

export const ACTIVITY_LABEL = { thinking: 'Thinking', researching: 'Researching', building: 'Building', running: 'Commands', designing: 'Designing', checking: 'Checking', delegating: 'Handing off', asking: 'Waiting on you' }

const RESEARCH_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'WebSearch', 'WebFetch', 'ToolSearch'])
const BUILD_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const DELEGATE_TOOLS = new Set(['Agent', 'Task', 'SendMessage', 'TaskStop'])
const READ_VERB = /(^|_)(get|find|list|read|search|screenshot|fetch|query|describe)/i

// The server registry (servers.json, written by the mod) says what kind of work each MCP server does.
const REGISTRY_REFRESH_MS = 30 * SECOND
let registry = {}, registryReadAt = 0
function serverKind(server) {
  if (Date.now() - registryReadAt > REGISTRY_REFRESH_MS) {
    try { registry = JSON.parse(readFileSync(livePath('servers.json'), 'utf8')) } catch {}
    registryReadAt = Date.now()
  }
  const hit = Object.entries(registry).find(([k]) => k.toLowerCase() === server.toLowerCase())
  return hit?.[1]?.kind
}

export function activityOf(tool) {
  if (tool === 'AskUserQuestion' || tool === 'ExitPlanMode') return 'asking'
  if (DELEGATE_TOOLS.has(tool) || /delegate_task|t3_thread_(send|wait|launch)|task_(status|cancel)/.test(tool)) return 'delegating'
  if (RESEARCH_TOOLS.has(tool)) return 'researching'
  if (BUILD_TOOLS.has(tool)) return 'building'
  const server = mcpServerOf(tool)
  if (server) {
    const reading = READ_VERB.test(tool.slice(tool.indexOf('__', 5) + 2))
    const kind = serverKind(server)
    if (kind === 'research') return 'researching'
    if (kind === 'design') return reading ? 'checking' : 'designing'
    if (kind === 'build') return reading ? 'researching' : 'building'
    return reading ? 'researching' : 'running'
  }
  if (/html_(preview|render)|Artifact/.test(tool)) return 'designing'
  if (/screenshot|preview_(snapshot|status)/.test(tool)) return 'checking'
  return 'running'
}
