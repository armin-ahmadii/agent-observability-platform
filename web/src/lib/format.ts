// Number, time and text formatting shared by every area.
export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

export function usd(n: number) {
  if (n > 0 && n < 0.01) return '<$0.01'
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
export function tok(n: number) {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e5) return Math.round(n / 1e3) + 'k'
  if (n >= 1e4) return (n / 1e3).toFixed(1).replace('.0', '') + 'k'
  return Math.round(n).toLocaleString('en-US')
}
export function dur(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return s + 's'
  const m = Math.floor(s / 60)
  if (m < 10) return m + 'm ' + String(s % 60).padStart(2, '0') + 's'
  if (m < 60) return m + 'm'
  return Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm'
}
export const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
export const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / MINUTE)
  return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`
}
export const whenReset = (iso?: string) => {
  if (!iso) return ''
  const d = new Date(iso)
  const days = (d.getTime() - Date.now()) / DAY
  return 'resets ' + (days < 1 ? clock(d.getTime()) : d.toLocaleDateString([], { weekday: 'short' }) + ' ' + d.toLocaleTimeString([], { hour: 'numeric' }))
}
export const plural = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`
// A message as a one-line label: attachment markers like "[File: a.zip; ref=…]" keep only the file name, images drop out.
export const cleanMsg = (t: unknown) => String(t ?? '')
  .replace(/\[File:\s*([^;\]]+?)\s*(?:;[^\]]*)?\]/g, '$1')
  .replace(/\[(?:Attached image|Image)[^\]]*\]/gi, '')
  .replace(/\s+/g, ' ').trim()
// For the few pieces built as HTML strings (the tooltip and the cost card inside it).
export const escapeHtml = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
