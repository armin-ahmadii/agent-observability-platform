# Setting up subagent-deck

**For the human:** when this is done you get a "Subagents" panel inside Claude Code, and a page at
http://localhost:4791 that shows every Claude Code session on this computer: each agent, its steps ticking off
live, the tools it used, what it cost, and your usage limits. Everything stays on your computer.

**For the agent doing the setup:** follow the steps in order. Each step says what to run, how to check that it
worked, and what to do if it did not. Do not skip a check. Ask the human before any step marked **ASK**.

Words used below:
- `DECK_DIR` means the install folder: `~/.claude/mods/subagent-deck`. Use exactly this folder (see step 2).
- "The mod" is the part that runs inside Claude Code (`hooks/`). "The server" is the small local web server
  (`live/server.mjs`) that shows the page.

---

## Step 1. Check the requirements

Run:

```sh
uname -s            # Darwin = macOS, Linux = Linux
claude --version    # Claude Code
node --version      # Node.js
npm --version
```

Pass when:
- The OS is macOS or Linux. Windows is not supported (the paths and the background service below assume a
  Unix system).
- Claude Code is installed and supports mods (hooks modules). This mod was built and tested on Claude Code
  2.1.328. If the version is lower, run `claude update` and check again.
- Node is **22.13 or later** (24 LTS is fine). The server and the Codex tool use Node's built-in `node:sqlite`,
  which needs no flag from 22.13 on.
- `npm` prints a version.

If Node is missing or too old: **ASK** the human how they install software. Suggest `brew install node@24` on
macOS, or their distribution's package manager / nvm on Linux. Do not install anything without a yes.

## Step 2. Put the folder at `~/.claude/mods/subagent-deck`

By default the mod writes its data to the `live/` folder inside the folder Claude Code loads it from, and the
server reads the `live/` folder next to itself, so one clone keeps both pointed at the same place. Any folder works,
but use `~/.claude/mods/subagent-deck`: every command in this guide assumes it. To keep the data somewhere else,
see "Choosing the data folder" below.

```sh
mkdir -p ~/.claude/mods
git clone https://github.com/caleb05w/agent-observability-platform.git ~/.claude/mods/subagent-deck
```

(If the human already downloaded the folder somewhere else, move it to that path instead of cloning.)

Check: `ls -a ~/.claude/mods/subagent-deck` lists `hooks`, `live`, `web`, `.claude-plugin`, `SETUP.md`.

If `~/.claude/mods/subagent-deck` already exists: stop and **ASK** the human. It may be an older copy with their
data in `live/`.

Cloning is the recommended way. If the human installs the mod with `/plugin install` from a marketplace instead,
Claude Code puts it in a cache folder whose name includes the version, so each update would leave the old data
behind. For that install, set `SUBAGENT_DECK_LIVE` to a fixed folder (for example `~/.subagent-deck`) and run the
server with that same folder (see "Choosing the data folder"). The server still has to come from a clone or the
installed copy, built with step 3.

### Choosing the data folder (optional)

The data folder holds session files, the inbox and the JSON stores. Without any setting it is
`~/.claude/mods/subagent-deck/live`. To use another folder, set the environment variable `SUBAGENT_DECK_LIVE` to
its full path. Each part looks for the folder in this order:

| Part | Order |
|---|---|
| The mod (`hooks/live-dir.ts`) | `SUBAGENT_DECK_LIVE` → (a dev copy only: the `~/.claude/mods/<name>/live` it was copied from) → its own folder + `/live` → `~/.claude/mods/subagent-deck/live` |
| The server (`live/lib/live-dir.mjs`) | `--live <dir>` → `SUBAGENT_DECK_LIVE` → the `live/` folder next to `server.mjs` |
| The Codex tool (`live/codex-progress.mjs`) | `SUBAGENT_DECK_LIVE` → the `live/` folder next to it |

Rules when it is set:
- Every part must see the same value. Set it in Claude Code's environment (an `export` line in the shell profile,
  or the `env` block of `~/.claude/settings.json` next to the keys from step 4), **and** in the server's
  environment (`EnvironmentVariables` in the launchd plist, or `Environment=` in the systemd unit; both are shown
  in step 5), **and** in the Codex entry if Codex helpers are used (step "Codex (GPT) helpers").
- Use a full path (no `~` in the plist or the systemd unit).
- The page (`index.html`) always comes from the `live/` folder next to `server.mjs`, not from the data folder.
- The server creates `sessions/` in the data folder on its first run.

## Step 3. Build the page

```sh
cd ~/.claude/mods/subagent-deck/web
npm install
npm run build
```

Check: the build ends with `✓ built in …`, and this file now exists:

```sh
ls -la ~/.claude/mods/subagent-deck/live/index.html    # about 400 kB
```

`live/index.html` is build output, not source. It is ignored by git. Run `npm run build` again after every update
of the repository (`git pull`).

If `npm install` fails: check the Node version (step 1) and the network, then run it again. npm may warn about
`fsevents` install scripts; that warning is harmless.

## Step 4. Tell Claude Code to load the mod

Claude Code loads a mod from a folder named in `CLAUDE_CODE_PLUGIN_DIRS`, read from the `env` block of
`~/.claude/settings.json`.

1. Read `~/.claude/settings.json` first (create it with `{}` if it does not exist). Never replace the file: merge.
2. Add these two keys inside its `"env"` object (create `"env"` if it is missing):

   ```json
   "env": {
     "CLAUDE_CODE_PLUGIN_DIRS": "~/.claude/mods/subagent-deck",
     "CLAUDE_CODE_PLUGIN_DIR_WATCH": "1"
   }
   ```

   - If `CLAUDE_CODE_PLUGIN_DIRS` already has a value, keep it and append this folder after a `:` (for example
     `"/path/to/other-mod:~/.claude/mods/subagent-deck"`).
   - `CLAUDE_CODE_PLUGIN_DIR_WATCH` makes the desktop app and other long-running hosts reload the mod after an
     update. It is optional.
3. Check the file is still valid JSON: `node -e "JSON.parse(require('fs').readFileSync(process.env.HOME+'/.claude/settings.json','utf8'))" && echo ok`

Ask the human about the Haiku background helper now (see [The Haiku background helper](#the-haiku-background-helper);
default on). If they want it off, also add `"SUBAGENT_DECK_HAIKU": "off"` to the same `env` block.

Alternative for a one-off try without changing settings: `claude --plugin-dir ~/.claude/mods/subagent-deck`.

Check (optional, read-only): `claude plugin validate ~/.claude/mods/subagent-deck` ends with `Validation passed`.

The change applies to Claude Code sessions started **after** this step. Tell the human to start a new session
(the one you are running in will not pick it up).

## Step 5. Start the server

### Quick try (any OS)

```sh
node ~/.claude/mods/subagent-deck/live/server.mjs
```

It prints `subagent-deck on http://localhost:4791` and keeps running until you stop it (Ctrl+C). Options, all
optional:

```sh
node live/server.mjs --help                       # prints the options and exits
node live/server.mjs --port 4795                  # another port (default 4791; -p also works)
node live/server.mjs --live /full/path/to/data    # another data folder (see "Choosing the data folder")
node live/server.mjs 4795 /full/path/to/data      # older form: port, then data folder; still works
```

A wrong option or a port that is not a number prints the usage and exits with code 2.

The server listens on `127.0.0.1` only (not reachable from other computers). It has no dependencies of its own.

Check: `curl -s http://localhost:4791/api/sessions` prints JSON that starts with `{"sessions":`.

If it prints `subagent-deck: port 4791 is already in use (another copy running?)` and exits with code 1: find what
holds the port with `lsof -nP -iTCP:4791 -sTCP:LISTEN`. If it is another copy of this server, use that copy;
otherwise pick another port (`node live/server.mjs --port 4795`) and use that port everywhere below.

### Keep it running: macOS (launchd)

**ASK** the human before adding a background service.

1. Get the two values to fill in:

   ```sh
   which node          # → NODE_PATH, e.g. /opt/homebrew/bin/node
   echo $HOME          # → HOME_DIR
   ```

   Use the full output. launchd does not expand `~` or `$HOME`.
2. Write this file to `~/Library/LaunchAgents/com.subagent-deck.server.plist`, replacing every `NODE_PATH` and
   `HOME_DIR`:

   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0">
   <dict>
     <key>Label</key>
     <string>com.subagent-deck.server</string>
     <key>ProgramArguments</key>
     <array>
       <string>NODE_PATH</string>
       <string>HOME_DIR/.claude/mods/subagent-deck/live/server.mjs</string>
       <string>--port</string>
       <string>4791</string>
     </array>
     <key>RunAtLoad</key>
     <true/>
     <key>KeepAlive</key>
     <true/>
     <key>ThrottleInterval</key>
     <integer>10</integer>
     <key>StandardOutPath</key>
     <string>HOME_DIR/.claude/mods/subagent-deck/live/server.log</string>
     <key>StandardErrorPath</key>
     <string>HOME_DIR/.claude/mods/subagent-deck/live/server.log</string>
   </dict>
   </plist>
   ```

   Only if `SUBAGENT_DECK_LIVE` is used: add this inside `<dict>` (full path, no `~`):

   ```xml
     <key>EnvironmentVariables</key>
     <dict>
       <key>SUBAGENT_DECK_LIVE</key>
       <string>DATA_DIR</string>
     </dict>
   ```

3. Check and load it:

   ```sh
   plutil -lint ~/Library/LaunchAgents/com.subagent-deck.server.plist     # must print OK
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.subagent-deck.server.plist
   ```

   If `bootstrap` says the service is already loaded, run `launchctl kickstart -k gui/$(id -u)/com.subagent-deck.server` instead.

4. Check: `launchctl print gui/$(id -u)/com.subagent-deck.server | grep -m1 state` prints `state = running`, and
   the `curl` check from the quick try passes. If it is not running, read `~/.claude/mods/subagent-deck/live/server.log`.

- Restart (after a `git pull` that changed `live/`): `launchctl kickstart -k gui/$(id -u)/com.subagent-deck.server`
- Stop until next login: `launchctl bootout gui/$(id -u)/com.subagent-deck.server`
- Logs: `~/.claude/mods/subagent-deck/live/server.log`
- If Node is upgraded and `which node` changes, update `NODE_PATH` in the plist, then bootout and bootstrap again.

### Keep it running: Linux (systemd user service)

**ASK** the human before adding a background service.

1. `which node` → `NODE_PATH`.
2. Write `~/.config/systemd/user/subagent-deck.service`, replacing `NODE_PATH`:

   ```ini
   [Unit]
   Description=subagent-deck dashboard (http://localhost:4791)

   [Service]
   ExecStart=NODE_PATH %h/.claude/mods/subagent-deck/live/server.mjs --port 4791
   # Only if SUBAGENT_DECK_LIVE is used (full path):
   # Environment=SUBAGENT_DECK_LIVE=DATA_DIR
   Restart=always
   RestartSec=10
   StandardOutput=append:%h/.claude/mods/subagent-deck/live/server.log
   StandardError=append:%h/.claude/mods/subagent-deck/live/server.log

   [Install]
   WantedBy=default.target
   ```

3. Load and start it:

   ```sh
   systemctl --user daemon-reload
   systemctl --user enable --now subagent-deck.service
   ```

4. Check: `systemctl --user is-active subagent-deck.service` prints `active`, and the `curl` check passes.

- Restart: `systemctl --user restart subagent-deck.service`
- Logs: `~/.claude/mods/subagent-deck/live/server.log` (or `journalctl --user -u subagent-deck.service`)
- To keep it running while logged out: `loginctl enable-linger $USER` (optional; **ASK** first).

## Step 6. Add instructions to the human's `~/.claude/CLAUDE.md`

The page shows each helper's steps ticking off only when the helper reports them with the `progress` tool that the
mod adds (its full name is `mcp__subagent-deck__progress`). Helpers do that only when told to. (Without
it, the page shows only steps guessed by [the Haiku background helper](#the-haiku-background-helper), which never
tick, or no steps if that helper is off.) With `ask`, the page groups the steps under each request the
helper worked on; steps sent without it go under the helper's own name.

**ASK** the human before editing `~/.claude/CLAUDE.md`. Append (do not replace anything) this block:

```markdown
# Agent progress (subagent-deck)

- In every brief you give a subagent or helper, tell it to report progress with the `progress` tool: the request it is working on (`ask`) and its steps at the start, then each step it starts and finishes, so the dashboard shows it live.
- When you are a subagent or helper and the `progress` tool is available, call it at the start with `ask` (the owner's request in 5–7 words, in their terms, e.g. "Add resolve button to failed rows") and your steps, then each time you start or finish a step. Send `ask` again only when you start on a different request.
```

Optional, only if the human wants the page to open at the start of each session. Pick the line that fits their
tool:

```markdown
- At the start of every new session, open http://localhost:4791 so I can watch my agents while we work. If it does not load, tell me in one line that the dashboard server is down.
```

Optional, for T3 Code users (uses T3's own preview tool):

```markdown
- In T3 Code, on the first reply of every new session, open http://localhost:4791 in the preview pane (`preview_open`), before anything else. Do not open it again later in the same session unless I ask.
```

## Step 7. Check that it all works

1. Open http://localhost:4791 in a browser. The page loads (it may be empty at first).
2. Start a **new** Claude Code session (step 4 only applies to new ones). In it, type `/subagents`. Claude Code
   answers `Subagent panel opened.` and shows a "Subagents" panel. This proves the mod is loaded.
3. In that session, ask for something that uses a subagent, for example:
   `Use a subagent to list the files in this folder. Tell it to report progress with the progress tool.`
4. Within a few seconds the page shows the session, then the subagent as a row. Its steps tick off as it calls
   `progress`, and it shows "done" when it finishes.
5. On disk: `ls ~/.claude/mods/subagent-deck/live/sessions/` shows a `<session-id>.json` file that updates about
   every 2 seconds while the session is open.

If the Haiku background helper is on, a "Background helper" row also appears once it has work, and rows get short
titles. If it is off, rows keep the agent's own label and there is no Background helper row; that is
expected (see [The Haiku background helper](#the-haiku-background-helper)).

For a deeper check after an update, run the commands in "Running the tests" in `README.md`.

Report to the human what passed. If something failed, use the troubleshooting list below.

## What gets created at runtime

All of this is in the data folder (`~/.claude/mods/subagent-deck/live/` unless `SUBAGENT_DECK_LIVE` is set), is private to the human (it holds message snippets,
agent briefs and costs) and is ignored by git (`.gitignore`). Never commit or share it.

| Path | Written by | What it is |
|---|---|---|
| `sessions/<id>.json` | the mod | One file per open session, rewritten every 2 s. The server deletes files older than a week. |
| `memory/*.json` | the mod and the server | Project memory events and votes. |
| `titles.json`, `done.json`, `grades.json` | the mod | Short agent titles, what each finished agent did, grades. |
| `servers.json` | the mod (and you, by hand) | The MCP server list: names, colours, icons. |
| `usage-hours.json` | the server | Cost and tokens per hour for the last 31 days. The first start reads 30 days of transcripts once; later starts read only what is new. |
| `hidden.json`, `resolved.json` | the server | Sessions hidden on the page, agent errors marked as resolved. |
| `inbox.jsonl` | the server | Presses on the page (save, on/off, thumbs) waiting for the mod. |
| `inbox.<session-id>.claimed` | the mod | Temporary: a session's claim on the inbox while it reads it. Safe to ignore. |
| `server.log` | launchd / systemd | Server output. |
| `sessions/<codex thread id>.json` | `codex-progress.mjs` | A Codex helper's progress (only with the Codex integration). |
| `index.html` | `npm run build` | The page. Always next to `server.mjs`, never in a custom data folder. |

Files that look like data but are source (keep them): `live/icons.json`, `live/app-icons/*.png`,
`live/server.mjs`, `live/lib/*.mjs`, `live/codex-progress.mjs`.

The server also **reads**, never writes: Claude Code transcripts in `~/.claude/projects/` (for cost, history and
titles).

## Optional integrations

### T3 Code

Nothing to set up. If `~/.t3/userdata/statev2.sqlite` exists, the server reads it **read-only** to show T3's chat
names, and the page merges T3 delegated helpers (`delegate_task`) into their parent's row. Needs Node 22.13+
(step 1). If the file is missing or busy, names fall back to the transcript title, then the first message.

### Haiku background helper

On by default, and it uses a little of the human's Claude usage. See
[The Haiku background helper](#the-haiku-background-helper) for what it does and how to turn it off.

### Codex (GPT) helpers

Codex does not load Claude Code mods, so Codex helpers cannot see the mod's `progress` tool. `live/codex-progress.mjs`
is a small MCP server (stdio, no dependencies) that gives Codex the same tool, with the same name and input.

What it adds: a Codex helper's row on the page shows its own steps ticking off live, its "now" line, and its token
count (read from Codex's own session log under `~/.codex/sessions`, or `$CODEX_HOME/sessions`). Cost shows "—",
because there is no price list for GPT models here.

Limits:
- It works only for Codex helpers that **T3 Code** started (`delegate_task`). It finds the right row like this:
  Codex puts its thread id on every tool call; T3 Code's database (`~/.t3/userdata/statev2.sqlite`, read-only) maps
  that thread to T3's child thread; exactly one delegated run in the session files names that child thread. If any
  step finds nothing, or more than one match, the call is dropped (it never guesses). Codex sessions started
  outside T3 Code report nothing.
- Needs Node 22.13 or later (it reads T3's database with `node:sqlite`).

Set it up (**ASK** first; back up `~/.codex/config.toml` before editing it):

1. Add this entry to `~/.codex/config.toml`. Replace `NODE_PATH` with the output of `which node` and `HOME_DIR`
   with the output of `echo $HOME` (full paths, no `~`):

   ```toml
   [mcp_servers.subagent-deck]
   command = "NODE_PATH"
   args = ["HOME_DIR/.claude/mods/subagent-deck/live/codex-progress.mjs"]
   default_tools_approval_mode = "approve"
   ```

   `default_tools_approval_mode = "approve"` lets helpers call `progress` without asking the human each time.
   Only if `SUBAGENT_DECK_LIVE` is used, also add `env = { SUBAGENT_DECK_LIVE = "DATA_DIR" }` to this entry.
2. Tell Codex helpers to use it. Append this to `~/.codex/AGENTS.md` (create the file if it does not exist):

   ```markdown
   # Progress

   - In every task, report progress with the `progress` tool so the dashboard shows it live: at the start, `ask` (the request in 5–7 words, e.g. "Add resolve button to failed rows") and your steps; then each step you start and finish. Send `ask` again only when you start on a different request.
   ```

3. Check: from a Claude Code session in T3 Code, delegate a small task to a Codex model and ask it to report
   progress. Its row on the page shows its steps ticking off and a token count. On disk, a
   `sessions/<codex thread id>.json` file appears in the data folder.

## The Haiku background helper

Read this section to the human in plain words, then ask the one-line question at the end.

**What it is for.** In each Claude Code session, the mod runs a small, cheap model (`claude-haiku-5-5`) in the
background to make the dashboard easier to read. It:
- gives each row a short title (for example "Build: timeline lanes UI");
- names each request the human sends in the main chat, in 5–7 words;
- guesses a step list for an agent until the agent reports its real steps;
- writes a short "what it did" list and a grade for each finished agent (grades suggest which agents are worth
  saving as helpers);
- reads the human's reactions (messages and thumbs) into project memory;
- names and colours new MCP servers.

It shows on the page as the "Background helper" row, with its own cost estimate (usually cents per day).

**What it costs.** It uses a little of the human's Claude plan or usage. It is **on by default**.

**How to turn it off.** Set the environment variable `SUBAGENT_DECK_HAIKU=off` where Claude Code sees it, then
start a new Claude Code session (sessions already open keep their setting). `0`, `false` and `no` also work, in
any case. Either:
- add it to the `env` block of `~/.claude/settings.json`, next to the keys from step 4 (merge; do not replace the
  file):
  ```json
  "SUBAGENT_DECK_HAIKU": "off"
  ```
- or add `export SUBAGENT_DECK_HAIKU=off` to the human's shell profile (for example `~/.zshrc`).

The server does not need this variable.

**How to turn it back on.** Remove the variable, then start a new session.

**What turns off:**
- Short titles. Rows show the agent's own label instead: its description, the delegated task title, or
  "Main conversation".
- Short names for your requests in the main chat. Each request is titled with its first 7 words instead, and
  messages under 4 words (like "ok" or "thanks") don't become a request.
- Guessed steps. Steps only show if the agent reports them with `progress` or keeps a to-do list.
- "What it did" lists.
- Grades, so no "worth saving" suggestions.
- Reading reactions (messages and thumbs) into project memory.
- Naming and sorting new MCP servers. The page shows the server's own name, a fixed colour made from the name, and
  the plug icon or a known app icon.
- The Background helper row and its cost.

**What still works:**
- One row per agent, with parent and child links.
- What each agent is doing now, and its timeline.
- Cost, tokens, model, effort, context use, cache expiry and status, from Claude Code's own records.
- Steps and the "now" line from the `progress` tool and from to-do lists, grouped under each request (`ask`).
- Each agent's result.
- Message routing (which agent each message went to).
- Finishing delegated rows when T3 Code says they are done.
- Saved helpers (`/swarm`, `/rename-helper`, `/forget-helper`, notebooks).
- The Subagents panel.
- Presses on the page.

Titles and grades made before it was turned off stay.

**Ask the human (default: on):** "The dashboard uses a small background model that costs a few cents a day of your
Claude usage to write short titles, step guesses and summaries. Keep it on?"

## Troubleshooting

| What you see | Likely cause | Do this |
|---|---|---|
| http://localhost:4791 does not load | The server is not running. | Start it (step 5). With launchd: `launchctl kickstart -k gui/$(id -u)/com.subagent-deck.server`, then read `live/server.log`. |
| The page says `index.html missing` | The page was not built. | Run step 3. |
| The page loads but shows no sessions | The mod is not loaded, or the session started before step 4. | Start a new session. Type `/subagents`: if Claude Code does not know the command, check step 4 (`env` block, exact path) and run `claude plugin validate ~/.claude/mods/subagent-deck`. |
| Sessions show, but agents never tick off steps | Helpers are not calling `progress`. | Do step 6, and check the brief tells the helper to use the tool. Steps shown hollow are the Haiku background helper's guesses. |
| The server prints `port 4791 is already in use` and exits | Another program (or another copy) holds the port. | `lsof -nP -iTCP:4791 -sTCP:LISTEN`, then stop the other program or use `--port` (step 5). |
| The server prints its usage and exits | A wrong option or port. | Fix the arguments; `node live/server.mjs --help` lists them. |
| launchd service keeps restarting (every 10 s) | Wrong `NODE_PATH`, wrong arguments, or the port is in use. | Read `live/server.log`; fix the plist; bootout and bootstrap again. |
| The page runs but stays empty with `SUBAGENT_DECK_LIVE` set | The mod and the server use different data folders. | Make the value the same in Claude Code's environment and the server's (see "Choosing the data folder"), then restart both. |
| No chat names from T3 Code | Node older than 22.13, or T3 Code not installed. | Upgrade Node to 22.13 or later (step 1). Otherwise this is expected. |
| Rows show long labels, no "Background helper" row | The Haiku background helper is off (`SUBAGENT_DECK_HAIKU`). | Expected when off. To turn it on, remove the variable and start a new session. |
| The first page load is slow | First run reads 30 days of transcripts once. | Wait; later starts are fast. |

## Uninstall

1. Stop and remove the background service.
   - macOS:
     ```sh
     launchctl bootout gui/$(id -u)/com.subagent-deck.server
     rm ~/Library/LaunchAgents/com.subagent-deck.server.plist
     ```
   - Linux:
     ```sh
     systemctl --user disable --now subagent-deck.service
     rm ~/.config/systemd/user/subagent-deck.service
     systemctl --user daemon-reload
     ```
2. In `~/.claude/settings.json`, remove `~/.claude/mods/subagent-deck` from `CLAUDE_CODE_PLUGIN_DIRS` (delete the
   key if it was the only folder) and delete `CLAUDE_CODE_PLUGIN_DIR_WATCH` if nothing else needs it.
3. Remove the lines added in step 6 from `~/.claude/CLAUDE.md`, the "Progress" rule from `~/.codex/AGENTS.md`, and
   the `[mcp_servers.subagent-deck]` entry from `~/.codex/config.toml`, if they were added. Remove
   `SUBAGENT_DECK_LIVE` and `SUBAGENT_DECK_HAIKU` from the shell profile or `~/.claude/settings.json` if they were set.
4. **ASK** before this step, because it deletes the human's dashboard history:
   `rm -rf ~/.claude/mods/subagent-deck` (and the `SUBAGENT_DECK_LIVE` folder, if one was used)
