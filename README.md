# claude-mods

Private Claude Code mods. The repo is itself a marketplace (`drprockz-mods`).

## Install on a machine

At the prompt of a Claude Code terminal session (the machine needs GitHub access to this private repo, e.g. `gh auth login`):

```
/plugin install session-dash --marketplace drprockz/claude-mods
```

Answer `y` to add the marketplace and pick the **user** scope.

## session-dash

- **Sidebar**: `/dash` toggles it. It opens by itself in a fullscreen terminal unless `SESSION_DASH_AUTOOPEN=0`. It shows limits with pace, the context breakdown, models, live agents and workflows, and other Claude sessions on the machine.
- **Status line**: `bin/statusline.sh` shows the model, effort, session and month cost, context, and the 5-hour and 7-day limits.
- **Month cost**: `bin/cost.py` totals API-equivalent cost from transcripts for the calendar month (IST). The status line refreshes it in the background at most every 10 minutes, and the sidebar reads the same cache.
- **All-time usage**: `/dash all` opens a Usage pane with six tabs (Overview, Models, Projects, Tools & skills, Plugins & MCP, Timeline). Keys while it has focus: `1`–`6` tabs, `r` range (all / 7d / 30d), click a project (or Tab to its row, then Enter) to filter every tab, `x` clears it, Esc closes. `bin/history.py` rolls each transcript up into `~/.claude/session-dash/history-index.json` in the background when the pane opens; Claude Code deletes old transcripts, and their rollups stay in the index, so totals keep growing. Days before the index existed come from `~/.claude/stats-cache.json`, prompts per project from `~/.claude/history.jsonl`. Not counted: claude.ai web chats, per-call use of hook-only or LSP plugins, and claude.ai connectors never called. $ is API list price, not a bill.

On each session start the mod copies `bin/` to `~/.claude/session-dash/bin/` when the copies differ, so updating the plugin updates the scripts. If no status line is set, the mod sets one. It never replaces a status line you already have; run `/dash statusline` to switch to this one. The previous settings are saved as `~/.claude/settings.json.bak-session-dash`.

Needs `bash`, `awk` and `perl`. Works on macOS, Linux, and Windows under Git Bash (Claude Code runs the status line through Git Bash automatically when it's installed). `jq` is no longer required — the status line parses its JSON with `awk` instead, since `jq` isn't bundled with Git for Windows. `python3` is optional: it powers the month-to-date cost cache, which degrades quietly without it, and `/dash all`'s index, which shows the error in its pane without it. The dashboard's own file bookkeeping (heartbeats, peer cleanup, the installer) shells out to `mkdir`/`rm`/`mv`/`chmod` by name, so on Windows they need Git Bash's `usr/bin` on `PATH` (true for most Git-for-Windows installs already used as the terminal's shell).

## Update

Bump `version` in `plugins/session-dash/.claude-plugin/plugin.json`, push, then on each machine run `/plugin marketplace update drprockz-mods`.

## Develop

```
cd plugins/session-dash
claude plugin validate . && claude plugin test .
python3 -m unittest discover -s tests/py
```

`claude --plugin-dir plugins/session-dash` runs a session with the working copy.
