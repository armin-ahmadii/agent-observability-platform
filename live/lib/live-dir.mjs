// The folder the mod, this server and codex-progress.mjs share (session files, inbox, JSON stores).
// All three must resolve the same one; the mod's rule is in hooks/live-dir.ts.
import { fileURLToPath } from 'node:url'

const LIVE_DIR_ENV = 'SUBAGENT_DECK_LIVE'

// The live/ folder this code ships in (also where `npm run build` writes the page).
export const OWN_LIVE_DIR = fileURLToPath(new URL('..', import.meta.url)).replace(/\/+$/, '')

// SUBAGENT_DECK_LIVE with spaces and trailing slashes trimmed; null when unset or blank.
function liveDirFromEnv(env = process.env) {
  const trimmed = env[LIVE_DIR_ENV]?.trim().replace(/\/+$/, '')
  return trimmed || null
}

// In order: an explicit folder (the server's --live), then SUBAGENT_DECK_LIVE, then this code's own live/ folder.
export const resolveLiveDir = (explicit = null) => explicit || liveDirFromEnv() || OWN_LIVE_DIR
