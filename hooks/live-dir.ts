// Where the mod and the dashboard server share their files (session
// snapshots, the inbox, the JSON stores). Both must resolve the same folder.

/**
 * The shared folder, in order:
 * 1. `override` (the SUBAGENT_DECK_LIVE variable), when set.
 * 2. For a dev copy Claude Code loads from `<home>/.claude/dev-mods/<session>/<name>`:
 *    the folder it was copied from, `<home>/.claude/mods/<name>/live`, where its server runs.
 * 3. `<plugin root>/live`, beside the server that ships in it.
 * 4. With no plugin root: `<home>/.claude/mods/subagent-deck/live`.
 */
export function liveDirFor(root: string, override?: string, home?: string): string {
  const trimmed = override?.trim().replace(/\/+$/, '')
  if (trimmed) return trimmed
  const dev = /^(.*)\/\.claude\/dev-mods\/[^/]+\/([^/]+)\/?$/.exec(root)
  if (dev) return `${dev[1]}/.claude/mods/${dev[2]}/live`
  if (root) return `${root.replace(/\/+$/, '')}/live`
  return `${home ?? ''}/.claude/mods/subagent-deck/live`
}
