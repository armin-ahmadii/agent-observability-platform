// T3 Code's database, opened read-only for one batch of queries. Never written.
// Missing database, no node:sqlite, or busy: `fn` is not run and the result is null.
import { existsSync } from 'node:fs'
import { T3_DB_PATH } from './home-paths.mjs'

const T3_DB_TIMEOUT_MS = 50 // the dashboard would rather skip a name than wait
let sqlite = null

// `timeoutMs`: how long to wait while T3 is writing.
export function withT3Db(fn, timeoutMs = T3_DB_TIMEOUT_MS) {
  let db
  try {
    sqlite ??= process.getBuiltinModule?.('node:sqlite') ?? null
    if (!sqlite || !existsSync(T3_DB_PATH)) return null
    db = new sqlite.DatabaseSync(T3_DB_PATH, { readOnly: true, timeout: timeoutMs })
    return fn(db)
  } catch {
    return null
  } finally {
    try { db?.close() } catch {}
  }
}
