# Agent dashboard (React)

The page at http://localhost:4791. Vite + React + TypeScript, built into ONE self-contained file: `../live/index.html`
(server.mjs serves it, adds the auto-reload script before `</body>`, and answers `/api/*`). Open tabs reload when it changes.

- `npm run build`: writes ../live/index.html (the live page). `DECK_OUT=<dir> npm run build` writes it elsewhere instead.
- `npm run dev`: dev server on http://localhost:4792 with hot reload, /api forwarded to :4791
- `npm run typecheck`: TypeScript check
- `npm run icons`: regenerate src/icons/svgs.ts (add names in scripts/gen-icons.mjs). Only needed to add new icons: the generated icons are committed. It needs a Central Icons license and its CLI (`central-icon.mjs`; see the script).

Icons are Central Icons (iconists license, see LICENSE); add new ones with gen-icons.mjs.

## Where things live

| Area | Code | CSS |
|---|---|---|
| Page layout, skeleton/content crossfade | src/App.tsx | styles/base.css (tokens, light/dark), styles/sections.css |
| Top bar: back button, session switcher + menu | src/components/topbar/TopBar.tsx | styles/topbar.css |
| 5-hour limit bar, weekly ring | src/components/topbar/Limits.tsx | styles/topbar.css |
| Show/hide sections menu | src/components/topbar/SettingsMenu.tsx | styles/settings.css |
| Stat boxes | src/components/stats/Stats.tsx | styles/stats.css |
| Cost card (HTML shown in the tooltip) | src/components/stats/costCard.ts | styles/stats.css |
| Timeframe picker (All sessions) | src/components/stats/WinPicker.tsx | styles/stats.css |
| Agents section, Earlier agents, Previous orchestrators | src/components/agents/Agents.tsx | styles/agents.css |
| Row lists (live tree, background helper, earlier, chats) | src/components/agents/rowItems.tsx | styles/agents.css |
| One row: frame, title + note, count, progress ring, save button | src/components/agents/RowParts.tsx | styles/agents.css |
| Row click/keyboard handling | src/components/agents/rowEvents.ts | |
| Resolve (clears a stopped/failed/error marker, dashboard only) | RowParts.tsx `RowAction` → rowEvents.ts → `deck.resolve` → POST /api/resolve | styles/agents.css (`.act.res`) |
| Scroll to an agent asked for from Tasks | src/components/agents/useReveal.ts | |
| Opened agent: heading, current requests, result; "More details" fold (past requests, prompt, meta, View details, thumbs, lanes) | src/components/breakdown/Breakdown.tsx | styles/breakdown.css |
| Its checklist (to-dos, done items, planned steps, helper jobs) | src/components/breakdown/Checklist.tsx | styles/breakdown.css |
| Its lanes timeline | src/components/breakdown/Lanes.tsx | styles/breakdown.css |
| Light Markdown for results | src/components/breakdown/MdLite.tsx | styles/breakdown.css |
| Your prompts as balls: an avatar-style stack per row ("+n" past three), the bubble that becomes a ball, the traveller that rides the tree line to a helper's row, the row's flash | src/components/messages/MessageBalls.tsx (the `.balls` column is in RowParts.tsx) | styles/agents.css (`.balls`, `.ball`, `.mf*`) |
| Tasks (your recent requests and where they went) | src/components/Requests.tsx | styles/requests.css |
| MCP servers | src/components/McpServers.tsx | styles/mcp.css |
| Project memory | src/components/ProjectMemory.tsx | styles/memory.css |
| Saved helpers (+ the .tog switch) | src/components/Helpers.tsx | styles/helpers.css |
| Tooltip (data-tip / data-sub, cost card box) | src/components/Tooltip.tsx | styles/tooltip.css |
| Loading skeleton | src/components/Skeleton.tsx | styles/skeleton.css |
| Shared pieces: logo, model name, two-tone title, markers, thumbs, "+N more" | src/components/common.tsx | |
| Progress ring SVG | src/components/Ring.tsx | |
| Keeps the page up if drawing throws (retries on the next poll) | src/components/RetryOnPoll.tsx | |
| Motion: Fold, Rows, Appear, Pop | src/components/motion.tsx | |
| Narrow widths (820/600/480/420/380), reduced motion | | styles/responsive.css (imported last) |

Data and logic:
- `src/data/store.ts`: all state. Polls /api/sessions + /api/session every 1.5s; fetches math, history, mcp-history, memory, titles, grades, done; every action (choose session, fold, open, save, vote, settings). Components read it with `useDeck()`.
- `src/data/api.ts`: every server call. `src/data/storage.ts`: browser storage that never throws.
- `src/lib/agents.ts`: rules about one agent (states, Queued, live note, steps, checklist, short titles, memory ids).
- `src/lib/tree.ts`: the agent tree (`buildModel`), what Agents keeps on screen, and Earlier agents.
- `src/lib/modAsks.ts`: asking the mod for short titles, grades and done lists (once per agent per page load).
- `src/lib/segments.ts`: work stretches → lanes. `src/lib/models.ts`: model names/logos. `src/lib/servers.ts`: server names/colours/icons.
- `src/lib/format.ts`: usd/tok/dur/time/escape. `src/lib/sessions.ts`: session names. `src/lib/ids.ts`: `localId` (a run's id inside its own session). `src/lib/theme.ts`: dark-mode query. `src/lib/types.ts`: what the server sends.

Notes:
- CSS is plain global CSS, imported in `main.tsx`; the order matters for the cascade.
- Fonts: Geist and Geist Mono (OFL) come from `@fontsource-variable/*` and are inlined into the built page, so it needs no network.
- Rows are keyed by agent id, so the 1.5s refresh never remounts them; row lists are flat arrays of `<Fold>`s because `<Rows>` animates only its direct children.
- App icons for MCP servers come from `../live/app-icons/*.png`, and some icons from `../live/icons.json` (both are source files, not runtime data).

## Data from the mod

Added to each session file `live/sessions/<id>.json` (types in `../types/index.d.ts`):

**Top level**
- `lastAsk: Ask | null` — your newest real message in this session (null until one arrives after the mod loaded).
- `recentAsks: Ask[]` — the last 5, newest first (`recentAsks[0]` is `lastAsk`).
- `Ask = { at: number; text: string; routedTo: Route[]; answeredAt?: number }`
  - `text`: first 160 chars, `<system-reminder>`/`<t3_context>` blocks removed, whitespace collapsed. T3 "Delegated task node:…" notices and `<task-notification>` messages are not counted as asks.
  - `answeredAt`: set when the main conversation's turn ends. While it is unset the turn is still running.
  - `routedTo`: every agent work went to between the message and the end of that turn, in order, deduped by `runId`+`kind`.
- `Route = { runId: string; label: string; model?: string; kind: 'subagent' | 'delegated' | 'followup' }`
  - `subagent`: a Claude subagent spawned (`runId` = its run id).
  - `delegated`: a T3 `delegate_task` (`runId` = `task:<ms>`, same as the delegated run's `id`).
  - `followup`: SendMessage to an existing helper, a resumed subagent, or T3 `t3_thread_send` to a child thread. `runId` is the matching run's `id` when found; otherwise the raw target name/thread id (then no run has that id).

**On each run (`runs[]`)**
- `tasks?: { id?: string; text: string; status: 'pending' | 'in_progress' | 'done' }[]` — the agent's own to-do list (TodoWrite replaces it whole; TaskCreate/TaskUpdate edit it; `id` only for TaskCreate items). Order = order written.
- `tasksAt?: number` — when `tasks` last changed (ms).
- `plan?: string[]` — 3–6 planned steps (≤6 words, imperative) Haiku guessed from the brief, for subagent, delegated and other agent runs, and for `main` from the first message it saw. Never marked done. Show `tasks` when present, else `plan` (as not-started steps).
- `childThreadId?: string` — on delegated runs, when the delegate_task result names the child thread.
- T3 delegated helpers carry their own `tasks`/`plan` on the `main` run of their own session file; merge as you already do for that row.

### What a finished agent did (`done`)
- On runs: `done?: string[]` — 0–6 items (usually 3–6), imperative, ≤6 words (e.g. "Swap approved afters into flows"). Haiku makes them from the brief + handed-back result, listing only what the result says was completed; anything it says was not done is left out. `[]` means the result claims nothing completed.
- Made once per agent, live, when a subagent finishes with a result and has no `tasks`. In a T3 helper's own session it is made for its `main` run after its first answered turn (key `main:<sessionId>`), so the delegated row can merge it from the child session.
- Show order of preference for a row's checklist: `tasks` (live to-do list), else `done` (finished), else `plan` (not started).
- **GET `/api/done`** → `{ [agentId]: { items: string[]; at: number } }` from `live/done.json`. Keys: subagent ids as in `/api/history` rows, `main:<sessionId>` for a session's main run. `{}` when empty.
- **Asking for earlier agents:** POST `/api/action` with `{ kind: 'done', items: [{ id, label, brief, result }] }` (up to 60; `sessionId` optional — the server hands it to that session if open, else the newest open one). The mod skips ids already in `done.json`, runs them one at a time, and writes results there; poll `/api/done` to pick them up. Only send rows that have a non-empty `result`.

### Live progress (`progress` tool)
- The mod registers a tool `mcp__subagent-deck__progress` in every session it loads in (T3 helpers' own sessions too). Agents call it with `{ steps?, done?, current?, now? }`; no model calls are made.
- On runs:
  - `plan?: string[]` — from the agent's own `progress` call when `planSource === 'agent'` (≤8 steps, ≤6 words; a later call replaces the list, agents append by resending it longer). Otherwise Haiku's guess from the brief (`planSource === 'guess'`), which never ticks.
  - `planSource?: 'agent' | 'guess'`
  - `planDone?: number[]` — indexes into `plan` the agent reported finished; only grows (reset only if the agent replaces its steps with fewer). Only set when `planSource === 'agent'`.
  - `planNow?: number` — index of the step the agent says it is on; cleared when that step is reported done.
  - `nowText?: string` — ≤5 words, what the agent says it is doing now. (Not `now`: `now` stays the Activity, e.g. `'building'`/`'done'`.)
  - `nowAt?: number` — when `nowText` was set (ms).
- `short` is made again (Haiku, once per follow-up) from the latest instruction when a follow-up arrives: SendMessage / resumed subagent, `t3_thread_send` (updates the delegated row, key `task:<label>`), or a later user message for `main`. Old title kept if Haiku fails.
- Show order for a row's checklist is unchanged: `tasks`, else `done`, else `plan` (tick with `planDone`/`planNow` only when `planSource === 'agent'`).
- On the `triage` run (Background helper): `triageJobs?: { what: string; at: number; ok: boolean }[]` — every Haiku job it ran, oldest first, last 30. `what` is the same short label as its timeline segment (e.g. "Named an agent", `Planned "<agent>"`, "Read your reaction"); `ok` is false when the call threw (timeout/network) or gave no answer. Kept with the run, so it survives mod reloads.

## Timeframes and names in All sessions (server)

- **Usage store:** `live/usage-hours.json` (about 0.6 MB) holds every session's cost/tokens per hour and per model for the last 31 days, per transcript file (subagents included). `live/lib/usage-store.mjs` fills it by reading only new bytes of each transcript (a one-time 30-day backfill on first run, newest files first), prunes buckets older than 31 days, and sums buckets for every window. A window counts replies in hours that started inside it.
- **Endpoints:** `/api/session?id=all&win=active|24h|7d|30d` (`day` = the window's totals; `active` also takes `s=<ids>`, the chats the page shows as working, plus their T3 helpers; it sums their last 24 hours), `/api/math?id=all&win=…` (per-model math for the window), `/api/history?id=all&win=…` (agents finished in the window; T3 helpers only while their session files exist, up to 7 days), `/api/chats?win=…` (Previous orchestrators: every chat with usage in the window, newest first, amounts with its helpers).
- **Session names:** T3's own chat names are read read-only from `~/.t3/userdata/statev2.sqlite` (`orchestration_v2_projection_provider_threads.nativeThreadRef.nativeId` → `orchestration_v2_projection_threads.title`, deleted threads skipped), cached 10 s. Order: T3's name → the transcript's custom/AI title → the first message. If the database is missing or busy, names silently fall back. `sessions[].rawTitle` keeps the transcript title for matching T3 helpers to their delegated rows.
- **Hidden sessions:** the session menu's hide button sends POST `/api/hide` `{ id }`. To show a session again: POST `/api/hide` `{ "id": "<session id>", "unhide": true }` (it also comes back by itself once it has new activity).
