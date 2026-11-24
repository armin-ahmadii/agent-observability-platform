// T3 Code's database, opened read-only for one batch of queries. Never written.
// Missing database, no node:sqlite, or busy: `fn` is not run and the result is null.
import { existsSync } from 'node:fs'
import { T3_DB_PATH } from './paths.mjs'

const T3_DB_TIMEOUT_MS = 50
let sqlite = null

export function withT3Db(fn) {
  let db
  try {
    sqlite ??= process.getBuiltinModule?.('node:sqlite') ?? null
    if (!sqlite || !existsSync(T3_DB_PATH)) return null
    db = new sqlite.DatabaseSync(T3_DB_PATH, { readOnly: true, timeout: T3_DB_TIMEOUT_MS })
    return fn(db)
  } catch {
    return null
  } finally {
    try { db?.close() } catch {}
  }
}
