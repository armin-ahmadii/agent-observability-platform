// The usage card: every subscription's limits, one line each (how much is left, when it resets) with a thin bar.
// Each subscription's section is a choice (data-action="ring:<sub>"): the chosen one, checked, is the top-bar ring.
// Built as HTML because it shows inside the shared tooltip box.
import { clock, escapeHtml as esc, MINUTE, whenReset } from '../../lib/format'
import { SVGS } from '../../icons/svgs'
import type { CodexLimits, Limit, Subscription } from '../../lib/types'

// From this share used, bars and rings turn the warning colour.
export const HOT_PCT = 80
// A reading older than this says when it is from.
const STALE_MS = 5 * MINUTE

const CLAUDE_WINDOWS: Record<string, string> = { five_hour: '5-hour', seven_day: 'Weekly', seven_day_opus: 'Weekly (Opus)', seven_day_sonnet: 'Weekly (Sonnet)' }
const claudeOrder = (k: string) => k === 'five_hour' ? 0 : k === 'seven_day' ? 1 : 2
const claudeName = (kind: string) => CLAUDE_WINDOWS[kind] ?? kind.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())
function windowName(minutes: number | null, fallback: string) {
  if (!minutes) return fallback
  if (minutes === 10080) return 'Weekly'
  if (minutes === 1440) return 'Daily'
  return minutes % 1440 === 0 ? `${minutes / 1440}-day` : minutes % 60 === 0 ? `${minutes / 60}-hour` : `${minutes}-minute`
}

function line(name: string, percentUsed: number, resetsAt?: string | null) {
  const used = Math.min(100, Math.max(0, percentUsed))
  return `<div class="ln"><span>${esc(name)}</span>${resetsAt ? `<em>${esc(whenReset(resetsAt))}</em>` : ''}<b>${Math.round(100 - used)}% left</b></div>` +
    `<div class="ub"><i style="width:${used.toFixed(1)}%"${used >= HOT_PCT ? ' class="hot"' : ''}></i></div>`
}
const CHECK = `<svg width="16" height="16" viewBox="${SVGS.check.viewBox}" fill="none" aria-hidden="true">${SVGS.check.inner}</svg>`
function heading(name: string, at: number | null, chosen: boolean) {
  const stale = !!at && Date.now() - at > STALE_MS
  const sameDay = !!at && new Date(at).toDateString() === new Date().toDateString()
  const when = stale ? `as of ${sameDay ? '' : new Date(at!).toLocaleDateString([], { weekday: 'short' }) + ' '}${clock(at!)}` : ''
  return `<h4><span>${esc(name)}</span>${when ? `<em>${esc(when)}</em>` : ''}<i class="ck">${chosen ? CHECK : ''}</i></h4>`
}
const section = (sub: Subscription, chosen: boolean, body: string) =>
  `<div class="sub" role="button" tabindex="0" data-action="ring:${sub}" aria-pressed="${chosen}">${body}</div>`

export function usageCardHtml(claude: Limit[], claudeAt: number | null, codex: CodexLimits | null, shown: Subscription | null) {
  let out = ''
  if (claude.length) {
    out += section('claude', shown === 'claude', heading('Claude', claudeAt, shown === 'claude') + [...claude].sort((a, b) => claudeOrder(a.kind) - claudeOrder(b.kind))
      .map(l => line(claudeName(l.kind), l.percentUsed, l.resetsAt)).join(''))
  }
  if (codex?.limits.length) {
    const plan = codex.plan ? ' ' + codex.plan.replace(/^\w/, c => c.toUpperCase()) : ''
    out += section('chatgpt', shown === 'chatgpt', heading('ChatGPT' + plan, codex.at, shown === 'chatgpt') + [...codex.limits].sort((a, b) => (a.minutes ?? 0) - (b.minutes ?? 0))
      .map(l => line(windowName(l.minutes, l.window), l.percentUsed, l.resetsAt)).join(''))
  }
  return out
}
