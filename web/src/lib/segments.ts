// Stretches of work on an agent's timeline (its lanes).
import { deck } from '../data/store'
import { ACTS } from './agents'
import type { Segment } from './types'

const isAct = (a?: string): a is string => (ACTS as readonly string[]).includes(a ?? '')
// Older records without an activity fall back by what their MCP server is for.
const ACT_BY_SERVER_KIND: Record<string, string> = { design: 'designing', research: 'researching', build: 'building' }

// Every stretch belongs to one kind of work.
export const actOf = (s: Segment): string => isAct(s.act) ? s.act : isAct(s.key) ? s.key
  : s.server ? ACT_BY_SERVER_KIND[deck.snap?.servers?.[s.server]?.kind ?? ''] ?? 'running' : 'running'

// Back-to-back slices of the same thing closer than this share of the bar are joined,
// so the bar shows a few readable blocks, not slivers.
const JOIN_GAP = 0.03
export function mergeSegs(list: Segment[], span: number) {
  const out: Segment[] = []
  for (const s of list) {
    const last = out[out.length - 1]
    if (last && last.key === s.key && s.start - last.end < span * JOIN_GAP) out[out.length - 1] = { ...last, end: s.end, tokens: (last.tokens ?? 0) + (s.tokens ?? 0) }
    else out.push({ ...s })
  }
  return out
}
