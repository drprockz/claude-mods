# `/dash all` — all-time usage dashboard for session-dash

Date: 2026-10-16
Status: approved design, spec under review
Visual design: https://claude.ai/artifact/KFa58NBVgkH375B1csYjNY (7 boards: Overview, Models, Projects, Tools & skills, Plugins & MCP, Timeline, Ledger design system)

## Goal

session-dash shows the **current** session. `/dash all` adds a tabbed panel that shows **everything over time**: every project, model, tool, skill, subagent, plugin and MCP server Claude Code has used on this machine, with estimated API cost. Nothing leaves the machine.

## Non-goals (v1)

- claude.ai web/desktop chat usage (not stored locally).
- Per-call counts for hook-only, status-line or LSP plugins (transcripts do not record them).
- claude.ai connectors that were never called (they are not listed in any local file).
- Export, sharing, charts outside the terminal.

## Data sources

| Source | Used for | Survives pruning |
|---|---|---|
| `~/.claude/projects/**/*.jsonl` (incl. `subagents/`) | per-call model, tokens, tools, skills, subagents, MCP calls, `cwd`, `gitBranch`, `version`, timestamps, `isSidechain` | no — Claude Code deletes old transcripts (`cleanupPeriodDays`) |
| `~/.claude/stats-cache.json` | `dailyActivity` (messages/sessions per day), `modelUsage` (tokens per model), `hourCounts`, `longestSession`, `firstSessionDate` | yes |
| `~/.claude/history.jsonl` | prompts per project path | longer than transcripts |
| `~/.claude/plugins/installed_plugins.json` + each `installPath` | installed plugins, their skills, agents, hooks, MCP, LSP | n/a |
| `~/.claude/skills/*` | user skills | n/a |

Transcripts are the only source with model/tool detail, and they get deleted, so **the index is also the archive**: once a session is rolled up, its rollup is kept after the transcript disappears.

## Architecture

```
bin/history.py ──writes──▶ ~/.claude/session-dash/history-index.json
      ▲                                   │
      │ $.process.run (background)        │ $.fs.read
      │                                   ▼
hooks/register.tsx  ──▶ hooks/lib/history.ts (pure aggregation: range, project filter, tabs)
                                          │
                                          ▼
                         hooks/view/history.tsx (6 tabs, Ledger styling)
```

Three units, each testable alone:

1. **Indexer** `bin/history.py` — Python, alongside `cost.py`, installed by the existing `installBundle` copy step. Turns files into per-session rollups. Knows nothing about the UI.
2. **Aggregator** `hooks/lib/history.ts` — pure functions: `(index, extras, {range, project, now}) → TabData`. No I/O.
3. **View** `hooks/view/history.tsx` — renders `TabData`. No I/O, no maths beyond layout.

### Pricing

The price table moves from `cost.py` into `bin/prices.py`, imported by both `cost.py` and `history.py`, so the status line, the sidebar and `/dash all` always agree. Add `'opus-4-5': (5, 25, 0.50)` (currently unpriced). Models without a price contribute tokens but $0 and are listed as unpriced, as `cost.py` already does. All $ are labelled "est." (API list prices, not a bill).

## Indexer: `bin/history.py`

```
history.py index     update the index incrementally, print {"ok":true,"files":N,"changed":M,"skipped":K,"ms":T}
history.py rebuild   drop the index and build it from scratch
```

**Incremental:** each transcript file is keyed by absolute path with `{size, mtime}`. Unchanged files are skipped; changed/new files are re-parsed whole (a transcript is append-only, but re-parsing whole keeps the logic simple and files are small). Files that no longer exist keep their rollup with `"pruned": true`.

**Dedup:** an API call is counted once per `(message.id, requestId)`, as `cost.py` does. Entries with `model` missing or `<synthetic>` are ignored for tokens.

**Per-session rollup** (one per transcript file; subagent files roll into their parent session id):

```json
{
  "sessionId": "…", "file": "…", "size": 0, "mtime": 0, "pruned": false,
  "cwd": "/home/u/STS/shooter-management-backend/.worktrees/feat-x",
  "project": "/home/u/STS/shooter-management-backend",
  "worktree": "feat-x",
  "start": "ISO", "end": "ISO",
  "versions": {"2.1.301": 12},
  "branches": {"feat/x": 40},
  "models": {"claude-opus-5": {"calls": 0, "in": 0, "out": 0, "cr": 0, "cw": 0, "usd": 0, "agentCalls": 0, "agentUsd": 0}},
  "tools": {"Bash": 0}, "skills": {"superpowers:brainstorming": 0},
  "agents": {"general-purpose": 0}, "mcp": {"claude_ai_Atlassian_Rovo": {"searchJiraIssuesUsingJql": 0}},
  "days": {"2026-10-16": 0}, "hours": {"12": 0}
}
```

- `project`: from the entries' `cwd`, with a trailing `/.worktrees/<name>` (or `/worktrees/<name>`) stripped into `worktree`. Falls back to decoding the folder name only when no entry has `cwd`.
- `days` / `hours`: API calls per local date / hour in the machine's timezone (IST here), from `timestamp`.
- `agentCalls` / `agentUsd`: the part of a model's calls with `isSidechain: true` or coming from a `subagents/` file.
- Tools from `tool_use` blocks on assistant messages. `Skill` → `skills[input.skill]`; `Agent`/`Task` → `agents[input.subagent_type or "general-purpose"]`; `mcp__<server>__<tool>` → `mcp[server][tool]` (and counted under `tools` as `mcp`).

**Index file** `~/.claude/session-dash/history-index.json`: `{"v": 1, "builtAt": "ISO", "tz": "+05:30", "sessions": {<file path>: rollup}}`, written atomically (tmp + `os.replace`) like `month-cost.json`. A version mismatch or unreadable JSON means rebuild.

**Errors:** unreadable files and bad JSON lines are skipped and counted in `skipped`; the run never fails because of one file. Exit code ≠ 0 only when the index cannot be written.

**Performance target:** cold build of the current 36 MB in under 3 s; warm run (nothing changed) under 300 ms. Lines without `"usage"`, `"tool_use"`, `"cwd"` or `"timestamp"` are skipped before `json.loads` where possible.

## Extras read by the mod (TypeScript, no Python)

Small files read directly with `$.fs.read` when the view opens:

- `stats-cache.json` → archived days (dates not present in any rollup), archived models (models in `modelUsage` absent from every rollup → "archived, tokens only"), `hourCounts`, `longestSession`, `firstSessionDate`, total sessions/messages.
- `history.jsonl` → prompts per `project` path (worktree paths fold into their repo the same way).
- `installed_plugins.json` + each plugin's `installPath`: name, marketplace, and what it ships — `skills/`, `agents/`, `commands/`, `.mcp.json`, `hooks/hooks.json` or `hooks` in `plugin.json`, `lspServers`. A plugin that only ships hooks/LSP/status line is **background**.
- `~/.claude/skills/*` → user skill names.

Plugin usage = calls attributable to it: skills named `<plugin>:<skill>` or listed in its `skills/`, agent types `<plugin>:<agent>`, MCP servers `plugin_<plugin>_*`. Status: **used** (> 0), **background** (ships only hooks/LSP/status line), **idle** (0).

## Aggregation: `hooks/lib/history.ts`

`aggregate(index, extras, opts) → Dash`, where `opts = {range: '7d' | '30d' | 'all', project?: string, now}`.

- Range filters on `days` keys of rollups and on stats-cache dates. A session counts if any of its days falls in range; its per-day calls are filtered exactly, model/tool/skill counts are counted whole for that session (rollups do not split them by day; good enough for 7d/30d).
- `project` filter limits every tab to that project's sessions.
- Produces one object per tab, matching the boards:
  - **Overview:** KPIs (sessions, messages, API calls, est. $, models live/archived, projects with/without transcripts), messages per active day, model mix by $, top 4 projects, top 4 tools, top 3 skills, insights.
  - **Models:** per model calls, in, out, cache read, cache write, hit % = `cr / (cr + cw + in)`, $/call, $; call share; archived rows; cost split (input/output/cache read/cache write) for the top model; main vs agent split.
  - **Projects:** grouped by parent folder (`~/STS`, `~/Projects`, other), worktrees nested; prompts, sessions, calls, $, last active; selected-project detail (share, models, branches).
  - **Tools & skills:** tool counts (log-scaled bars), skills with source (`built-in` / `yours` / plugin name), installed-but-never-invoked skills, subagent types.
  - **Plugins & MCP:** every installed plugin with status and usage; MCP servers seen in calls or configured, with per-tool counts for the selected server.
  - **Timeline:** active days, current/longest streak, longest session, average gap, calendar (16 weeks), sessions by hour, Claude Code versions (first/last seen; the newest is "current"; a version still seen after a newer one is flagged), biggest days.
- **Insights:** at most 1 per tab, rule-based, each with a threshold so nothing is shown when it is not true: top model ≥ 60% of $; cache read ≥ 50% of top model $; one tool ≥ 60% of calls; `Edit` = 0 while `Bash` > 100; idle plugins ≥ 5; ≥ 50% of sessions in one hour; a plugin idle while an MCP server covering the same service is used (matched by name substring, e.g. "atlassian").

## View: `/dash all`

- `/dash all` toggles a pane `session-dash-all` (separate from the sidebar `session-dash`), wide placement, title "Usage". `/dash` and `/dash statusline` keep working as today; `/dash all` is added to the command description.
- On open: render immediately from the last index on disk (or a "building index…" line if none), run `history.py index` in the background, re-read and re-render when it finishes. Footer shows `indexed N files · T s · K skipped`.
- Tabs in a row; `←`/`→` (and `1`–`6`) switch. `r` cycles range 7d → 30d → all. On Projects, `↑`/`↓` select and `⏎` sets the project filter for all tabs; `x` clears it. `esc` closes. Hotkeys only while the pane has focus; clicks work anytime (existing `Button` pattern).
- Narrow terminals: below 100 columns, tables drop the cache columns and side panels stack under the main list. Below 60 columns the pane shows "Usage needs a wider terminal" (the existing `isPlaced` pattern).
- **Ledger styling:** colours added to `hooks/lib/palette.ts` as a `LEDGER` group (ground `#12151B`, surface `#151920`, line `#2A2F3A`, ink `#E4E7EC`, muted `#9AA3B2`, amber `#F5A524` = money and focus, blue `#5EA6FF` = counts, teal `#3DD6B0` = skills/used, purple `#B392F0`, rose `#F47C8A`). Model colours keep the existing `MODEL_COLOR` per family so the sidebar and `/dash all` agree. Glyphs: `● ■ ◆ ○ ⎇ ▲ ▁▂▃▅▇`, no emoji. Every bar has its number beside it; archived data is marked `○` or `—`; $ is always "est.".

## Error handling

| Failure | Behaviour |
|---|---|
| `python3` missing / indexer exits ≠ 0 | Pane shows the last index if any, plus one line with the error's first line |
| Index missing and indexer fails | Pane shows the error and "run /dash all again" |
| `stats-cache.json`, `history.jsonl`, plugin files unreadable | That part is empty; nothing else breaks |
| Index has an older `v` | Indexer rebuilds |
| Indexer already running (pane reopened) | Not started twice (module-level in-flight flag) |

## Testing

- **Python** `tests/history_test.py` (run with `python3 -m unittest`): fixture transcripts covering duplicate message ids, `<synthetic>`, sidechain + `subagents/` files, worktree `cwd`, missing `cwd`, bad JSON line, unpriced model, `Skill`/`Agent`/`mcp__` tool uses; incremental run (unchanged file not re-parsed, changed file re-parsed, deleted file kept as `pruned`); version mismatch → rebuild. `cost.py` keeps producing the same totals after the price-table move.
- **TypeScript** `tests/history.test.ts` (`claude plugin test`): `aggregate` for range and project filters, worktree grouping, archived models/days from stats-cache, plugin status, streaks, version flags, each insight rule on and off.
- **Views** `tests/views.test.tsx`: `/dash all` opens the `session-dash-all` pane; each tab renders from a fixture `Dash` at 160 and 80 columns; empty index renders the "building" state.

## Rollout

Bump session-dash to 0.3.0, update README (`/dash all`, the index file, what is and is not counted), push, `/plugin marketplace update drprockz-mods`.
