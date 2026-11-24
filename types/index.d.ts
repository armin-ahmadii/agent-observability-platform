export type Activity = 'thinking' | 'researching' | 'designing' | 'checking' | 'building' | 'running' | 'delegating' | 'asking' | 'done'

/** One stretch of a subagent's run spent on one MCP server, or on one built-in activity. */
export type Segment = {
  act?: Activity
  key: string
  label: string
  server?: string
  start: number
  end: number
  tokensAtStart: number
  tokens: number
}

export type Run = {
  id: string
  label: string
  /** Distilled title, e.g. "Build: timeline lanes UI" (Haiku, once per agent). */
  short?: string
  brief: string
  type: string
  model?: string
  effort?: string
  helper?: string
  now: Activity
  nowServer?: string
  startedAt: number
  segments: Segment[]
  mcp: Record<string, number>
  usd: number
  tokens: number
  savedAs?: string
  /** The agent that started this one: 'main' for the main conversation, or another run's id. */
  parentId?: string
  /** false when Claude Code keeps no cost ledger for this agent (batch/workflow runs). */
  costKnown?: boolean
  /** Where its loop stands, from agent.list (running, waiting, failed...). */
  status?: string
  /** Set when it needs you: held waiting, failed, stopped, or hit an error. */
  attention?: 'waiting' | 'failed' | 'stopped' | 'error'
  /** How full its memory (context window) is, in tokens. */
  context?: { used: number; window: number }
  /** The start of what it handed back when it finished. */
  result?: string
  /** When its saved conversation (prompt cache) runs out, ms since epoch. */
  cacheUntil?: number
  /** For the background helper: what it is doing right now. */
  doing?: string
  /** For the background helper: its Haiku jobs, oldest first, last 30. ok=false when the call failed or gave no answer. */
  triageJobs?: TriageJob[]
  /** Its own to-do list (TodoWrite / TaskCreate / TaskUpdate), newest state. */
  tasks?: TaskItem[]
  /** When `tasks` last changed, ms since epoch. */
  tasksAt?: number
  /** Its steps: from its own `progress` tool calls (planSource 'agent'), else Haiku's guess from its brief (planSource 'guess', never ticked). */
  plan?: string[]
  /** Where `plan` came from: the agent's `progress` tool, or Haiku's guess at spawn. */
  planSource?: 'agent' | 'guess'
  /** Indexes into `plan` the agent reported finished (`progress` tool). Only ever grows. */
  planDone?: number[]
  /** Index into `plan` of the step the agent says it is on (`progress` tool). */
  planNow?: number
  /** What it says it is doing right now, ≤5 words (`progress` tool). Named nowText because `now` is already the Activity. */
  nowText?: string
  /** When `nowText` was last set, ms since epoch. */
  nowAt?: number
  /** What its handed-back result says it completed (Haiku, 3-6 imperative items, once per agent). */
  done?: string[]
  /** The owner's requests this agent worked on, oldest first (last 20). Each owns its own steps; plan/planDone/planNow mirror the latest. */
  asks?: Ask[]
  /** For a T3 delegated run: the child thread id, when the delegate_task result names it. */
  childThreadId?: string
}

/** One job the background helper (Haiku) did, e.g. "Named an agent". `at` is ms since epoch. */
export type TriageJob = { what: string; at: number; ok: boolean }

/** One item of an agent's to-do list. `id` is the TaskCreate id (absent for TodoWrite). */
export type TaskItem = { id?: string; text: string; status: 'pending' | 'in_progress' | 'done' }

/** Where a request went: a new subagent, a T3 delegated task, or a follow-up to an existing helper. */
/**
 * Where a request went: a new subagent, a T3 delegated task, or a follow-up to an existing helper.
 * `runId` is the row's id in this session's runs. `sessionId`: for a T3 helper, its own Claude
 * session, once that session has started (filled in later for a new helper).
 */
export type Route = { runId: string; label: string; model?: string; kind: 'subagent' | 'delegated' | 'followup'; sessionId?: string }

/** One real message you sent, and the agents it was routed to before the main turn ended. */
export type RoutedAsk = { at: number; text: string; routedTo: Route[]; answeredAt?: number }

/**
 * One of the owner's requests an agent worked on, with its own steps (from the
 * `progress` tool's `ask`, or, in a session's main chat, from the owner's message).
 * `done` and `now` index into `steps`; `at` and `finishedAt` are ms since epoch.
 */
export type Ask = { title: string; at: number; steps: string[]; done: number[]; now?: number; nowText?: string; finishedAt?: number }

export type ServerKind = 'design' | 'research' | 'build' | 'run'

/** One entry of live/servers.json: yours (source 'you') or Haiku's guess (source 'triage'). */
export type ServerInfo = { label: string; kind: ServerKind; color: string; source: 'you' | 'triage' }

export type Helper = {
  name: string
  brief: string
  model?: string
  swarm?: string
  isOn: boolean
  notes: string[]
  uses: number
}

declare module 'claude-code' {
  interface PluginState {
    'subagent-deck': { runs: Shaped<Run[]>; helpers: Shaped<Helper[]>; asks: Shaped<RoutedAsk[]> }
  }
}
