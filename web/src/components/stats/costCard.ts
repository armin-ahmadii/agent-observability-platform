// The cost card: who spent the cost, and the per-model math. Built as HTML because it shows inside the shared tooltip box.
import { deck } from '../../data/store'
import { escapeHtml as esc, plural, tok, usd } from '../../lib/format'
import { modelInfo } from '../../lib/models'
import type { Model } from '../../lib/tree'
import type { CostMath, Snap } from '../../lib/types'

// Main gets whatever is left after subagents and the background helper, so the lines always add up to the total.
export function costSplit(m: Model, total: number) {
  const sum = (list: Model['runs']) => list.reduce((a, r) => a + (r.costKnown === false ? 0 : r.usd ?? 0), 0)
  const subUsd = sum(m.tree.filter(r => !m.roots.includes(r))), triUsd = m.triage ? sum([m.triage]) : 0
  return { subUsd, triUsd, mainUsd: Math.max(0, total - subUsd - triUsd) }
}

const line = (k: string, v: number) => `<div class="ln"><span>${esc(k)}</span><b>${usd(v)}</b></div>`
const totalLine = (v: number) => `<div class="ln tot"><span>Total</span><b>${usd(v)}</b></div>`
const WHY_HIGH = `Every reply re-sends the whole conversation. Claude bills those re-sent tokens cheaply as "re-read from cache", and they are left out of the Tokens count, which is why the cost is high for the tokens shown. Prices are list prices per million tokens (M).`
// "$0.3/M", "$0.075/M", "$15/M"
const rate = (r: number) => '$' + (r < 1 ? r.toFixed(r < 0.1 ? 3 : 2).replace(/0$/, '') : r) + '/M'
const mathLines = (models: NonNullable<CostMath['models']>) => models.length ? '<h4>The math</h4>' + models.map(mo =>
  `<div class="ln mh"><span>${esc(modelInfo(mo.model).name)} · ${mo.requests} replies</span><b>${usd(mo.usd)}</b></div>` +
  mo.parts.map(x => `<div class="ln sub"><span>${esc(x.label)}</span><em>${tok(x.tokens)} × ${x.rate == null ? '?' : rate(x.rate)}</em><b>${x.usd == null ? '—' : usd(x.usd)}</b></div>`).join('')
).join('') : ''

// All sessions: the timeframe's totals across every chat, open or closed, from their saved records.
export function dayCardHtml(d: NonNullable<Snap['day']>) {
  const { math } = deck
  return '<h4>Who spent it</h4>' +
    line(`Main conversations (${plural(d.chats, 'chat', 'chats')})`, d.mainUsd) +
    line(`Subagents (${d.subs})`, d.subUsd) +
    (math?.id === 'all' && (math.win ?? '24h') === (d.win ?? '24h') ? mathLines(math.models ?? []) : '') +
    totalLine(d.usd) +
    `<p>${WHY_HIGH}</p>`
}

// One session: its agents' split, the per-model math, and what Claude Code spent on its own side requests.
export function costCardHtml(m: Model, total: number) {
  const { math } = deck
  const tops = m.roots.length, subs = m.tree.length - tops
  const { subUsd, triUsd, mainUsd } = costSplit(m, total)
  const unpriced = m.tree.filter(r => r.costKnown === false).length
  const mathHtml = math?.models?.length ? mathLines(math.models) + (total - math.usd > 0.01
    ? `<div class="ln mh"><span>Claude Code's own side requests</span><b>${usd(total - math.usd)}</b></div>` : '') : ''
  return '<h4>Who spent it</h4>' +
    line(tops === 1 ? 'Main conversation' : `Main agents (${tops})`, mainUsd) +
    line(`Subagents (${subs})`, subUsd) +
    (m.triage ? line('Server sorting (Haiku)', triUsd) : '') +
    mathHtml +
    totalLine(total) +
    `<p>${WHY_HIGH}${unpriced ? ` ${unpriced} ${unpriced === 1 ? 'agent has' : 'agents have'} no price yet and ${unpriced === 1 ? 'is' : 'are'} counted in the main line.` : ''}</p>`
}
