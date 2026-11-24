// Shapes of what the server sends. Loose on purpose: the mod adds fields over time.
export type Segment = { start: number; end: number; key?: string; act?: string; server?: string; label?: string; tokens?: number }
export type Run = {
  id: string
  label?: string
  brief?: string
  result?: string
  type?: string
  kind?: string
  model?: string
  effort?: string
  parentId?: string | null
  now?: string
  status?: string
  nowServer?: string
  startedAt?: number
  endedAt?: number
  segments?: Segment[]
  mcp?: Record<string, number>
  usd?: number
  tokens?: number
  costKnown?: boolean
  short?: string
  sessionOf?: string
  session?: string
  attention?: string
  context?: { used: number; window: number }
  savedAs?: string
  helper?: unknown
  doing?: string
  errors?: number
  past?: boolean
  live?: boolean
  tasks?: TaskItem[]
  tasksAt?: number
  plan?: string[]
  done?: string[]
  childThreadId?: string
  where?: string
  lastAskAt?: number // All sessions: when that chat's latest message came in (main rows)
  nowAt?: number // when the mod last described what the agent is doing (the text is in nowText, or in now when it isn't a state word)
  nowText?: string
  planDone?: number[]
  planSource?: 'agent' | 'guess'
  triageJobs?: { what: string; at: number; ok?: boolean }[] // the background helper's recent jobs, newest last
  planNow?: number
  [k: string]: unknown
}
export type TaskItem = { id?: string; text: string; status: 'pending' | 'in_progress' | 'done' }
export type Route = { runId: string; label: string; model?: string; kind: 'subagent' | 'delegated' | 'followup' }
export type Ask = { at: number; text: string; routedTo: Route[]; answeredAt?: number }
export type Helper = { name: string; isOn?: boolean; swarm?: boolean; model?: string; notes?: unknown[]; uses?: number }
export type Snap = {
  sessionId: string
  project?: string
  updatedAt?: number
  totalUsd?: number
  servers?: Record<string, { label?: string; color?: string; kind?: string }>
  serverTokens?: Record<string, number>
  runs?: Run[]
  helpers?: Helper[]
  lastAsk?: Ask | null
  recentAsks?: Ask[]
  // All sessions: each open T3 helper's own main run, by the helper's session id (saves fetching each helper's session).
  helperMains?: Record<string, { main: Run | null; lastAskAt?: number }>
  day?: { win?: string; usd: number; tokens: number; mainUsd: number; subUsd: number; chats: number; subs: number }
}
export type Session = {
  id: string
  title?: string
  rawTitle?: string // the transcript's own title (T3 may name the chat differently); used to match T3 helpers
  project?: string
  isLive?: boolean
  working?: number
  totalUsd?: number
  weekPct?: number | null
  weekPctAll?: number | null
  weekTokens?: number
  startedAt?: number
  updatedAt: number
  parentId?: string
  costKnown?: boolean // false for Codex (GPT) helpers: no price list, so cost shows as "—"
  model?: string
  tokens?: number
  day?: { usd: number; tokens: number; mainUsd: number; mainTokens: number } // this chat's last 24 hours
}
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type Subscription = 'claude' | 'chatgpt'
// The ChatGPT plan's limits, read by the server from Codex's logs. `at`: when Codex last reported them.
export type CodexLimits = { plan: string | null; at: number; limits: { window: string; minutes: number | null; percentUsed: number; resetsAt: string | null }[] }
export type MathModel = { model: string; requests: number; usd: number; parts: { label: string; tokens: number; rate: number | null; usd: number | null }[] }
export type CostMath = { id: string; win?: string; usd: number; models?: MathModel[]; pace?: { last10: number }; cache?: { until?: number; rewriteUsd?: number; rereadUsd?: number } }
export type McpRow = { server: string; calls: number; lastAt: number; tools: { name: string; n: number }[]; agents: unknown[] }
export type Reaction = { id: string; score: number; label?: string; model?: string; kind?: string }
export type MemEvent = { at: number; source?: string; quote?: string; lesson?: string; reactions?: Reaction[] }
export type MemAgent = { id: string; label?: string; model?: string; kind?: string; score: number; ups: number; downs: number; thumb?: number; last?: { quote?: string; at: number } | null; unrated?: boolean; result?: string | null; sessionOf?: string; short?: string; brief?: string; type?: string }
export type Memory = { id: string; events: MemEvent[]; agents: MemAgent[]; lessons: { text: string; count: number }[] }
export type Grade = { grade: string; why?: string; at?: number }

// All sessions' timeframes, in the order the picker shows them.
export const WINS = ['active', '24h', '7d', '30d'] as const
export type Win = typeof WINS[number]
// GET /api/done: what a finished agent completed. Older mod versions stored a bare list.
export type DoneEntry = { items: string[]; at: number } | string[]
export type Chat = { id: string; title: string; project?: string; model?: string; usd: number; tokens: number; last: number }
