// Where the server reads and writes (see cli.mjs for the options).
import { join } from 'node:path'
import { options } from './cli.mjs'
import { OWN_LIVE_DIR, resolveLiveDir } from './live-dir.mjs'

export const PORT = options.port

// The shared data folder: session files from the mod, the inbox and the JSON stores.
export const LIVE_DIR = resolveLiveDir(options.liveDir)
export const livePath = name => join(LIVE_DIR, name)
// The built page always comes from beside this code, wherever the data folder is.
export const PAGE_PATH = join(OWN_LIVE_DIR, 'index.html')
export const SESSIONS_DIR = livePath('sessions')
export const sessionPath = id => join(SESSIONS_DIR, `${id}.json`)
export const MEMORY_DIR = livePath('memory')
export const INBOX_PATH = livePath('inbox.jsonl')

export { PROJECTS_DIR, T3_DB_PATH } from './home-paths.mjs'

// Session ids come from query strings and file names: only letters, digits, "_" and "-".
export const isId = id => /^[\w-]+$/.test(id)
