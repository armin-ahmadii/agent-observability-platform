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

  mock.env(on, opts.env ?? {})
  const files: Record<string, string> = {}
  on('fs.exists', (_, e) => ({ value: (e as { path: string }).path in files }) as never)
  on('fs.read', (_, e) => ({ value: files[(e as { path: string }).path] ?? '' }) as never)
  on('fs.write', (_, e) => {
    const w = e as { path: string; text?: string }
    files[w.path] = String(w.text ?? '')
    return { value: undefined } as never
  })
  // The three commands the inbox drain runs, over the in-memory files.
  const ran: string[][] = []
  on('process.run', (_, e) => {
    const { argv, init } = e as { argv: string[]; init?: { stdin?: string } }
    ran.push([...argv])
    opts.beforeRun?.(argv)
    const done = (exitCode: number) => ({ value: { exitCode, stdout: '', stderr: '' } as never })
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

  return { files, clock, fileEnding, snapshot, ran }
}

/** A Haiku reply with a little usage. */
export const answer = (text: string) => ({ value: { isAnswered: true, text, usage: { input_tokens: 10, output_tokens: 5 } } as never })
