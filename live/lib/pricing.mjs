// List prices in US dollars per million tokens: [input, output, cache write 5 min, cache write 1 hour, cache read].
const PRICES = {
  'claude-fable-5-2': [8, 40, 10, 16, 0.2],
  'claude-fable-5-1': [10, 50, 12.5, 20, 0.25],
  'claude-opus-5-5': [4, 20, 5, 8, 0.2],
  'claude-opus-5': [5, 25, 6.25, 10, 0.5],
  'claude-sonnet-5-5': [2, 10, 2.5, 4, 0.1],
  'claude-sonnet-5': [2, 10, 2.5, 4, 0.2],
  'claude-haiku-5-5': [0.1, 0.5, 0.125, 0.2, 0.01],
}
const PER_MTOK = 1e6

// Accepts provider prefixes, "[1m]"-style suffixes and dated ids.
function priceOf(model) {
  const m = String(model).replace(/^anthropic\./, '').replace(/\[.*\]$/, '').replace(/-\d{8}$/, '')
  return PRICES[m] ?? PRICES[Object.keys(PRICES).find(k => m.startsWith(k)) ?? '']
}

// Cache writes split by lifetime. Older transcripts give only the total, which counts as 5-minute writes.
export function cacheWrites(u) {
  const w1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0
  const w5m = u.cache_creation?.ephemeral_5m_input_tokens ?? Math.max(0, (u.cache_creation_input_tokens ?? 0) - w1h)
  return { w5m, w1h }
}

// Tokens a reply processed, as the dashboard counts them (cache reads left out).
export const replyTokens = u => (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)

// One reply's cost at list price.
export function replyUsd(model, u) {
  const p = priceOf(model)
  if (!p) return 0
  const { w5m, w1h } = cacheWrites(u)
  return ((u.input_tokens ?? 0) * p[0] + (u.output_tokens ?? 0) * p[1] + w5m * p[2] + w1h * p[3] + (u.cache_read_input_tokens ?? 0) * p[4]) / PER_MTOK
}

// A model's cost broken into the lines the page shows. `t`: token totals { input, output, write5m, write1h, read }.
export function priceParts(model, t) {
  const p = priceOf(model)
  const parts = [
    ['New input', t.input, p?.[0]],
    ['Output (incl. thinking)', t.output, p?.[1]],
    ['Saved to cache (5 min)', t.write5m, p?.[2]],
    ['Saved to cache (1 hour)', t.write1h, p?.[3]],
    ['Re-read from cache', t.read, p?.[4]],
  ].filter(([, n]) => n > 0).map(([label, tokens, rate]) => ({ label, tokens, rate: rate ?? null, usd: rate == null ? null : tokens * rate / PER_MTOK }))
  return { parts, usd: parts.reduce((a, x) => a + (x.usd ?? 0), 0), priced: !!p }
}

// Price of re-saving or re-reading `tokens` from the prompt cache.
export const cacheRewriteUsd = (model, tokens, longLived) => {
  const p = priceOf(model)
  return p ? tokens * (longLived ? p[3] : p[2]) / PER_MTOK : null
}
export const cacheRereadUsd = (model, tokens) => {
  const p = priceOf(model)
  return p ? tokens * p[4] / PER_MTOK : null
}
