# Agent Observability Platform

See what every Claude Code agent is doing, live: its steps, tools, cost and results.

Internally the mod is named `subagent-deck` (folder, settings and tool names use that name).

A Claude Code mod that shows what your agents are doing. In the terminal it adds a panel that traces each subagent
(its plan, tools and cost) and can save a good one as a reusable helper. Alongside it, a small local web page at
http://localhost:4791 shows every session at once: agents and their timelines, MCP servers, cost math, your share
of the weekly limit, and project memory.

**To install:** hand [SETUP.md](SETUP.md) to your coding agent and ask it to set this up (macOS or Linux).

## Layout

| Folder | What it is |
|---|---|
| `hooks/`, `types/`, `tests/` | The mod. Each session writes `live/sessions/<session-id>.json` every 2 seconds. |
| `live/server.mjs`, `live/lib/` | The local server (Node, no dependencies). Serves the page and `/api/*`. |
| `live/codex-progress.mjs` | The `progress` tool for Codex (GPT) helpers started from T3 Code (see SETUP.md). |
| `web/` | The page (React + Vite). `npm run build` writes `live/index.html`. See `web/README.md`. |
| `live/` (other files) | Runtime data written by the mod and the server (or in `$SUBAGENT_DECK_LIVE` if set). Not part of the source (see `.gitignore`). |

## What the server reads

- `live/sessions/*.json` from the mod (deleted after a week).
- Claude Code transcripts in `~/.claude/projects` for cost, history and titles. Usage per hour is kept in
  `live/usage-hours.json`, so a restart only reads what is new.
- T3 Code's database (`~/.t3/userdata/statev2.sqlite`), read-only, for chat names when it is there.

Presses on the page (save, on/off, thumbs, grades) go back to the mod as lines in `live/inbox.jsonl`.

## Running the tests

From this folder:

| What | Command |
|---|---|
| Mod (hooks) | `claude plugin validate . && claude plugin test .` |
| Server (`live/`) | `node --test 'live/test/*.test.mjs'` (keep the quotes) |
| Page (`web/`) | `cd web && npm run typecheck` |

## License

MIT (see [LICENSE](LICENSE)), except the bundled Central Icons (`web/src/icons/svgs.ts`, `live/icons.json`): they
belong to iconists and are included under their license for use in this project only, so do not copy them out for
other uses. App logos in `live/app-icons/` belong to their owners.
