// Shared mocks for the tests: a session "s1" whose agent spawns as "a1", an
// in-memory file system, and a fake clock. Each test passes only what differs.
import { mock } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]
type Hook = (...args: never[]) => unknown

type Options = {
  /** What `agent.spawn` answers with, or a function giving it per spawn (default: Opus, id "a1"). */
  spawned?: { model: string; agentId: string } | (() => { model: string; agentId: string })
  /** What `agent.list` returns (default: none). */
  agents?: unknown[]
  /** The session's total cost (default: $0.10). */
  usd?: number
  /** Answers tool calls (default: an empty result). */
  toolCall?: Hook
  /** Answers Haiku calls (default: no answer). */
  modelComplete?: Hook
  /** Environment variables the mod can read (default: none). */
  env?: Record<string, string>
  /** Called before each process.run command, e.g. to stage another writer racing it. */
  beforeRun?: (argv: string[]) => void
  /** The transcript path $.session.info() reports (default: none). */
  transcript?: string
  /** Answer $.state.get/set from a store the test can empty, as a compaction does (see `compact`). */
  ownState?: boolean
  /** Called with each tool.register input. */
  onToolRegister?: (spec: { name: string; description: string; isDeferred?: boolean }) => void
}

export function setup(on: On, opts: Options = {}) {
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('tool.register', (_, e) => {
    opts.onToolRegister?.(e as never)
    return { value: { tool: `mcp__subagent-deck__${(e as { name: string }).name}` } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.register', (_, e) => ({ value: { agent: `subagent-deck:${e.name}` } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.hookEnv', () => ({ value: { CLAUDE_CODE_SESSION_ID: 's1' } as never }))
  on('agent.spawn', () => (typeof opts.spawned === 'function' ? opts.spawned() : opts.spawned) ?? { model: 'claude-opus-5-5', agentId: 'a1' })
  on('agent.list', () => ({ value: (opts.agents ?? []) as never }))
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [], cost: { usd: opts.usd ?? 0.1 } } as never }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('prompt.submit', (_, e) => ({ text: e.text }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  on('tool.call', (opts.toolCall ?? (() => ({ result: {} }) as never)) as never)
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('model.complete', (opts.modelComplete ?? (() => ({ value: { isAnswered: false, text: '' } as never }))) as never)

  on('session.info', () => ({ value: { transcriptPath: opts.transcript ?? '' } as never }))
  // Plugin state the test owns, so it can empty it the way a compaction does.
  const state = new Map<string, { value: unknown; version: number }>()
  if (opts.ownState) {
    const keyOf = (e: unknown) => {
      const a = e as { plugin: string; key: string; id?: string }
      return `${a.plugin}/${a.key}/${a.id ?? ''}`
    }
    on('state.get', (_, e) => {
      const s = state.get(keyOf(e))
      return { value: { value: s?.value, version: s?.version ?? 0 } } as never
    })
    on('state.set', (_, e) => {
      const w = e as { value: unknown; ifVersion?: number }
      const k = keyOf(e)
      const version = state.get(k)?.version ?? 0
      if (w.ifVersion !== undefined && w.ifVersion !== version) return { value: { isSet: false, version } } as never
      state.set(k, { value: w.value, version: version + 1 })
      return { value: { isSet: true, version: version + 1 } } as never
    })
  }
  /** Empty the plugin state, as Claude Code does on a compaction (needs `ownState`). */
  const compact = () => state.clear()

  mock.env(on, opts.env ?? {})
  const files: Record<string, string> = {}
  /** How often each path was read and written. */
  const reads: Record<string, number> = {}
  const writes: Record<string, number> = {}
  on('fs.exists', (_, e) => ({ value: (e as { path: string }).path in files }) as never)
  // mtimeMs stands in as a hash of the content, so a test that edits a file directly also "touches" it.
  on('fs.stat', (_, e) => {
    const text = files[(e as { path: string }).path]
    if (text === undefined) return { deny: 'ENOENT' } as never
    let hash = 0
    for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0
    return { value: { kind: 'file', size: text.length, mtimeMs: hash, isLink: false } } as never
  })
  on('fs.read', (_, e) => {
    const path = (e as { path: string }).path
    reads[path] = (reads[path] ?? 0) + 1
    return { value: files[path] ?? '' } as never
  })
  on('fs.write', (_, e) => {
    const w = e as { path: string; text?: string }
    files[w.path] = String(w.text ?? '')
    writes[w.path] = (writes[w.path] ?? 0) + 1
    return { value: undefined } as never
  })
  // The three commands the inbox drain runs, over the in-memory files.
  const ran: string[][] = []
  on('process.run', (_, e) => {
    const { argv, init } = e as { argv: string[]; init?: { stdin?: string } }
    ran.push([...argv])
    opts.beforeRun?.(argv)
    const done = (exitCode: number, stdout = '') => ({ value: { exitCode, stdout, stderr: '' } as never })
    if (argv[0] === 'sh' && /^grep -F /.test(argv[2] ?? '')) {
      // restore.ts's transcript pipeline: grep -F -e '<p>'… "$1" | grep -F -v '<x>' | tail -c N
      const cmd = argv[2]!
      const patterns = [...cmd.matchAll(/-e '([^']*)'/g)].map(m => m[1]!)
      const exclude = /-v '([^']*)'/.exec(cmd)?.[1]
      const text = files[argv[4]!]
      if (text === undefined) return done(2)
      const hits = text.split('\n').filter(l => l && patterns.some(p => l.includes(p)) && !(exclude && l.includes(exclude)))
      return done(hits.length ? 0 : 1, hits.map(l => l + '\n').join(''))
    }
    if (argv[0] === 'mv') {
      const [, from, to] = argv as [string, string, string]
      if (!(from in files)) return done(1)
      files[to] = files[from]!
      delete files[from]
      return done(0)
    }
    if (argv[0] === 'sh' && argv[2] === 'cat >> "$1"') {
      const to = argv[4]!
      files[to] = (files[to] ?? '') + (init?.stdin ?? '')
      return done(0)
    }
    if (argv[0] === 'rm') {
      delete files[argv[argv.length - 1]!]
      return done(0)
    }
    return done(127)
  })
  const clock = mock.clock(on, { now: 1_000_000 })

  /** The file whose path ends with `suffix`, e.g. "/live/done.json". */
  const fileEnding = (suffix: string) => Object.keys(files).find(p => p.endsWith(suffix))
  /** The published snapshot of session s1. */
  const snapshot = <T = { runs: { id: string; type: string; now: string }[] }>() => JSON.parse(files[fileEnding('/sessions/s1.json')!]!) as T

  return { files, clock, fileEnding, snapshot, ran, reads, writes, compact }
}

/** A Haiku reply with a little usage. */
export const answer = (text: string) => ({ value: { isAnswered: true, text, usage: { input_tokens: 10, output_tokens: 5 } } as never })

/**
 * $.tool.call, typed loosely. Its full typing, spelled out many times across the
 * test files, trips TypeScript's instantiation-depth limit (TS2589).
 */
export const callTool = ($: unknown, input: Record<string, unknown>) =>
  ($ as { tool: { call: (i: unknown) => Promise<{ text?: string }> } }).tool.call(input)
