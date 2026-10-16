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

On each session start the mod copies `bin/` to `~/.claude/session-dash/bin/` when the copies differ, so updating the plugin updates the scripts. If no status line is set, the mod sets one. It never replaces a status line you already have; run `/dash statusline` to switch to this one. The previous settings are saved as `~/.claude/settings.json.bak-session-dash`.

Needs `bash`, `awk` and `perl`. Works on macOS, Linux, and Windows under Git Bash (Claude Code runs the status line through Git Bash automatically when it's installed). `jq` is no longer required — the status line parses its JSON with `awk` instead, since `jq` isn't bundled with Git for Windows. `python3` is optional: it only powers the month-to-date cost cache, and that feature degrades quietly without it. The dashboard's own file bookkeeping (heartbeats, peer cleanup, the installer) shells out to `mkdir`/`rm`/`mv`/`chmod` by name, so on Windows they need Git Bash's `usr/bin` on `PATH` (true for most Git-for-Windows installs already used as the terminal's shell).

## Update

Bump `version` in `plugins/session-dash/.claude-plugin/plugin.json`, push, then on each machine run `/plugin marketplace update drprockz-mods`.

## Develop

```
cd plugins/session-dash
claude plugin validate . && claude plugin test .
```

`claude --plugin-dir plugins/session-dash` runs a session with the working copy.
