// Folders other apps own, under your home folder. No side effects, so codex-progress.mjs can import it too
// (paths.mjs reads the server's command line when loaded).
import { homedir } from 'node:os'
import { join } from 'node:path'

export const PROJECTS_DIR = join(homedir(), '.claude', 'projects') // Claude Code's transcripts
export const T3_DB_PATH = join(homedir(), '.t3', 'userdata', 'statev2.sqlite') // T3 Code's database
export const CODEX_SESSIONS_DIR = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions') // Codex's logs
