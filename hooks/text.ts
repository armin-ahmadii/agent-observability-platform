// Pure text helpers: cleaning messages, short labels, number formats, and
// pulling JSON out of a model's reply.

/** Drop the context blocks Claude Code and T3 add to a message. */
export function stripContext(text: string): string {
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').replace(/<t3_context[\s\S]*?<\/t3_context>/g, '')
}

/** A message as one short line, without its context blocks. */
export function cleanAsk(text: string): string {
  return stripContext(text).replace(/\s+/g, ' ').trim().slice(0, 160)
}

/** The first `words` words of `value`, on one line, without a trailing full stop. */
export function clip(value: unknown, words: number, chars: number): string {
  return String(value).replace(/\s+/g, ' ').trim().replace(/[.]+$/, '').split(' ').slice(0, words).join(' ').slice(0, chars)
}

export function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'helper'
  )
}

export function money(usd: number): string {
  return usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`
}

export function count(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`
  return String(tokens)
}

/** "claude-opus-5-5" → "Opus". */
export function modelName(model?: string): string {
  if (!model) return ''
  const m = /(opus|sonnet|haiku|fable)/i.exec(model)
  return m?.[1] ? m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase() : model
}

/** The first {...} in a reply, parsed. Throws on broken JSON. */
export function jsonObjectIn<T>(text: string): T | undefined {
  const json = /\{[\s\S]*\}/.exec(text)?.[0]
  return json ? (JSON.parse(json) as T) : undefined
}

/** The first [...] in a reply, parsed. Throws on broken JSON. */
export function jsonArrayIn(text: string): unknown[] | undefined {
  const json = /\[[\s\S]*\]/.exec(text)?.[0]
  return json ? (JSON.parse(json) as unknown[]) : undefined
}

/** Up to 6 checklist steps, each at most 6 words, from a model's JSON array. */
export function stepsFrom(items: unknown[]): string[] {
  return items
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .map(s => s.trim().split(/\s+/).slice(0, 6).join(' ').replace(/[.]+$/, ''))
    .slice(0, 6)
}

/**
 * The child thread id in a delegate_task result, exactly as T3 wrote it
 * (ids carry URL-encoded colons, e.g. "thread:delegated-task:command%3Amcp%3A...").
 */
export function threadIdIn(value: unknown, depth = 0): string | undefined {
  if (depth > 6 || value == null) return undefined
  if (typeof value === 'string') {
    const t = value.trim()
    if (!t.startsWith('{') && !t.startsWith('[')) return undefined
    try {
      return threadIdIn(JSON.parse(t), depth + 1)
    } catch {
      return undefined
    }
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      const found = threadIdIn(v, depth + 1)
      if (found) return found
    }
    return undefined
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if (typeof obj.childThreadId === 'string' && obj.childThreadId) return obj.childThreadId
    for (const v of Object.values(obj)) {
      const found = threadIdIn(v, depth + 1)
      if (found) return found
    }
  }
  return undefined
}
