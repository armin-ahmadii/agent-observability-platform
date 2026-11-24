import type { IconName } from '../icons/svgs'
// Model: provider logo, short name ("Opus 5.5", "GPT-5.1 Codex"), and its brand color.
export type LogoIcon = IconName | 'app_muse'
const PROVIDERS: [RegExp, LogoIcon, string][] = [
  [/claude|opus|sonnet|haiku|fable/i, 'm_claude', '#d97757'],
  [/gpt|codex|openai|\bo\d/i, 'm_openai', 'light'],
  [/gemini/i, 'm_gemini', '#4285f4'],
  [/grok/i, 'm_grok', 'light'],
  [/mistral|codestral/i, 'm_mistral', '#fa520f'],
  [/deepseek/i, 'm_deepseek', '#4d6bfe'],
  [/llama/i, 'm_meta', '#0668e1'],
  [/muse/i, 'app_muse', 'app'],
]
const cap = (w: string) => w ? w[0].toUpperCase() + w.slice(1) : w
// Model ids → names. `name` is short, "<Family> <version>" like Claude's ("Opus 5.5", "Astra 6.2", "Codex 5.1", "Spark 1.3"),
// so it fits the rows' model column; `full` is the official name ("GPT-6.2 Astra") for tooltips and the opened agent.
export function modelInfo(model?: string): { icon: LogoIcon; color: string | null; name: string; full: string } {
  const m = String(model ?? '')
  const [, icon, color] = PROVIDERS.find(([re]) => re.test(m)) ?? [null, 'm_bot' as const, null]
  const id = m.replace(/^(anthropic|openai|google)[./]/i, '').replace(/^claude-/i, '').replace(/\[.*\]$/, '').replace(/-\d{8}$/, '')
  if (/^(opus|sonnet|haiku|fable)/i.test(id)) {
    const [fam, ...v] = id.split('-')
    const name = cap(fam.toLowerCase()) + (v.length ? ' ' + v.join('.') : '')
    return { icon, color, name, full: name }
  }
  // gpt-6.2-astra → "Astra 6.2" (official "GPT-6.2 Astra"); gpt-5.1-codex → "Codex 5.1"; plain gpt-5 stays "GPT-5".
  const gpt = /^gpt-?([\d.]+[a-z]?)(?:-(.+))?$/i.exec(id)
  if (gpt) {
    const words = (gpt[2] ?? '').split('-').filter(Boolean).map(w => cap(w.toLowerCase()))
    const full = `GPT-${gpt[1]}` + (words.length ? ' ' + words.join(' ') : '')
    return { icon, color, name: words.length ? `${words.join(' ')} ${gpt[1]}` : full, full }
  }
  // muse-spark-1.3 → "Spark 1.3"; muse-wonder-full-1.0 → "Wonder+ 1.0" (official "Muse Wonder Full 1.0").
  const muse = /^muse-(.+?)-([\d.]+)$/i.exec(id)
  if (muse) {
    const words = muse[1].split('-').map(w => cap(w.toLowerCase()))
    const fam = words.length > 1 && words[words.length - 1] === 'Full' ? words.slice(0, -1).join(' ') + '+' : words.join(' ')
    return { icon, color, name: `${fam} ${muse[2]}`, full: `Muse ${words.join(' ')} ${muse[2]}` }
  }
  const name = id ? id.split('-').map(cap).join(' ') : ''
  return { icon, color, name, full: name }
}
