// One session's cost, line by line from its transcripts, so the page can show the math.
import { cacheRereadUsd, cacheRewriteUsd, cacheWrites, priceParts, replyUsd } from './pricing.mjs'
import { MINUTE, HOUR } from './time.mjs'
import { isSubagentFile, readReplies, transcriptFiles } from './transcripts.mjs'

const CACHE_TTL_MS = { '5m': 5 * MINUTE, '1h': HOUR }

export function costMath(sessionId) {
  const per = {}
  const now = Date.now()
  const pace = { last10: 0, last60: 0 }
  let lastMain = null
  for (const f of transcriptFiles(sessionId)) {
    const sub = isSubagentFile(f)
    for (const { model, u, at } of readReplies(f).values()) {
      const cost = replyUsd(model, u)
      if (now - at < 10 * MINUTE) pace.last10 += cost
      if (now - at < HOUR) pace.last60 += cost
      if (!sub && (!lastMain || at > lastMain.at)) lastMain = { model, u, at }
      const row = (per[model] ??= { model, sub: 0, main: 0, input: 0, output: 0, write5m: 0, write1h: 0, read: 0 })
      const { w5m, w1h } = cacheWrites(u)
      row.input += u.input_tokens ?? 0
      row.output += u.output_tokens ?? 0
      row.write5m += w5m
      row.write1h += w1h
      row.read += u.cache_read_input_tokens ?? 0
      row[sub ? 'sub' : 'main']++
    }
  }
  const models = Object.values(per)
    .map(r => ({ model: r.model, requests: r.main + r.sub, ...priceParts(r.model, r) }))
    .sort((a, b) => b.usd - a.usd)
  return { models, usd: models.reduce((a, m) => a + m.usd, 0), pace, cache: promptCache(lastMain) }
}

// When the main conversation's saved copy (prompt cache) runs out, and what the next reply pays then.
function promptCache(lastMain) {
  if (!lastMain) return null
  const { u, model, at } = lastMain
  const longLived = (u.cache_creation?.ephemeral_1h_input_tokens ?? 0) > 0 || (u.cache_creation?.ephemeral_5m_input_tokens ?? 0) === 0
  const ttl = longLived ? '1h' : '5m'
  const size = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
  return { until: at + CACHE_TTL_MS[ttl], ttl, size, rewriteUsd: cacheRewriteUsd(model, size, longLived), rereadUsd: cacheRereadUsd(model, size) }
}
