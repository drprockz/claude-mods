# `/dash all` — all-time usage dashboard for session-dash

Date: 2026-10-16
Status: approved design; spec reviewed (1 round, issues fixed)
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

The price table moves from `cost.py` into `bin/prices.py`, imported by both (each script puts its own folder on `sys.path` first, because the status line runs them with `python3 -I`, which leaves it out). `prices.py` is first in `BUNDLE`, so a copy that stops partway never leaves a `cost.py` without its prices; a test holds that order. Sharing one table means the status line, the sidebar and `/dash all` always agree. Add `'opus-4-5': (5, 25, 0.50)` (currently unpriced). Models without a price contribute tokens but $0 and are listed as unpriced, as `cost.py` already does. All $ are labelled "est." (API list prices, not a bill).

## Indexer: `bin/history.py`

```
history.py index     update the index incrementally, print {"ok":true,"files":N,"changed":M,"skipped":K,"ms":T}
history.py rebuild   re-parse every transcript on disk; rollups of deleted transcripts are kept
```

**One rollup per transcript file**, keyed by absolute path with `{size, mtime}`. The aggregator groups rollups by `sessionId`; the indexer never merges files. Unchanged files are skipped; changed/new files are re-parsed whole. Files that no longer exist keep their rollup with `"pruned": true`.

**Agent files:** two layouts exist and both are agent files (`agentFile: true`): top-level `projects/<p>/agent-*.jsonl` (older; 424 of them here) and `projects/<p>/<session>/subagents/*.jsonl` (newer). The session id always comes from the entries' `sessionId` field (agent files carry the parent's), falling back to the file name.

**Dedup:** within a file, an API call is counted once per `(message.id, requestId)` (streamed replies repeat the id on every content block), a message once per `uuid`, a tool use once per `tool_use.id`. No cross-file dedup: the data has 0 duplicate call keys across files. Entries with `model` missing or `<synthetic>` are ignored for tokens. Sidechain "Warmup" calls are real API calls and count.

**Rollup** (one per transcript file):

```json
{
  "sessionId": "…", "size": 0, "mtime": 0, "pruned": false,
  "cwd": "/home/u/STS/shooter-management-backend/.worktrees/feat-x",
  "project": "/home/u/STS/shooter-management-backend",
  "worktree": "feat-x",
  "start": "ISO", "end": "ISO",
  "versions": {"2.1.301": 12},
  "branches": {"feat/x": 40},
  "models": {"claude-opus-5": {"calls": 0, "in": 0, "out": 0, "cr": 0, "cw": 0, "usd": 0, "agentCalls": 0, "agentUsd": 0}},
  "tools": {"Bash": 0}, "skills": {"superpowers:brainstorming": 0},
  "agents": {"general-purpose": 0}, "mcp": {"claude_ai_Atlassian_Rovo": {"searchJiraIssuesUsingJql": 0}},
  "days": {"2026-10-16": {"m": 0, "c": 0}}, "startDay": "2026-10-16", "startHour": 12,
  "agentFile": false, "unpriced": [], "skipped": 0
}
```

- `cwd`: the most frequent `cwd` in the file (5 files hold more than one). `project`: from that `cwd`, with a trailing `/.worktrees/<name>` (or `/worktrees/<name>`) stripped into `worktree`. Falls back to decoding the folder name only when no entry has `cwd`.
- `days`: `{date: {"m": messages, "c": API calls}}` per local date (machine timezone, IST here). A **message** is a `user` or `assistant` entry, the same unit as stats-cache's `messageCount`. `startDay`/`startHour`: local date and hour of the file's first entry.
- `agentCalls` / `agentUsd`: the part of a model's calls with `isSidechain: true` or coming from a `subagents/` file.
- Tools from `tool_use` blocks on assistant messages. `Skill` → `skills[input.skill]`; `Agent`/`Task` → `agents[input.subagent_type or "general-purpose"]`; `mcp__<server>__<tool>` → `mcp[server][tool]` (and counted under `tools` as `mcp`).

**Index file** `~/.claude/session-dash/history-index.json`: `{"v": 1, "builtAt": "ISO", "tz": "+05:30", "sessions": {<file path>: rollup}}`, written atomically (tmp + `os.replace`) like `month-cost.json`. An unreadable index or one with another `v` is first copied to `history-index.json.bak`, then rebuilt (its pruned rollups are lost only in that case, and the backup keeps them). Within a file, a malformed line is skipped and counted; a file that still fails to parse keeps its previous rollup.

**Errors:** unreadable files and bad JSON lines are skipped and counted in `skipped`; the run never fails because of one file. Exit code ≠ 0 only when the index cannot be written.

**Performance target:** cold build of the current 36 MB in under 3 s; warm run (nothing changed) under 300 ms. Lines without `"usage"`, `"tool_use"`, `"cwd"` or `"timestamp"` are skipped before `json.loads` where possible.

## Extras read by the mod (TypeScript, no Python)

Small files read directly with `$.fs.read` when the view opens:

- `stats-cache.json` → `dailyActivity`, `modelUsage` (models absent from every rollup → "archived, tokens only"), `hourCounts`, `longestSession`, `firstSessionDate`, `lastComputedDate`, total sessions/messages.
- `history.jsonl` → one line per prompt `{project, timestamp}` with `timestamp` in **epoch ms**; prompts per project (worktree paths fold into their repo the same way), filtered by range on that timestamp.
- `installed_plugins.json` is `{"version": 2, "plugins": {"<name>@<marketplace>": [{scope, installPath, …}]}}`: the plugin name is the part before `@`; of its entries the `user`-scope one wins, else the first. From its `installPath`: what it ships — `skills/`, `agents/`, `commands/`, `.mcp.json`, `hooks/hooks.json` or `hooks` in `plugin.json`, `lspServers`. A plugin that only ships hooks/LSP/status line is **background**.
- `~/.claude/skills/<name>/` → user skills ("yours"); the `synced` folder is skipped (those are claude.ai skills, invoked as `anthropic-skills:<name>`).

Skill source: `<plugin>:<skill>` → that plugin; `anthropic-skills:*` → "claude.ai"; a user skill name → "yours"; anything else → "built-in". "Installed, never invoked" lists user skills and plugin skills (folders under a plugin's `skills/`) with 0 calls.

Plugin usage = calls attributable to it: skills named `<plugin>:<skill>` or listed in its `skills/`, agent types `<plugin>:<agent>`, MCP servers `plugin_<plugin>_*`. Status: **used** (> 0), **background** (ships only hooks/LSP/status line), **idle** (0).

## Aggregation: `hooks/lib/history.ts`

`aggregate(index, extras, opts) → Dash`, where `opts = {range: '7d' | '30d' | 'all', project?: string, now}`.

- **Day series rule** (messages per day, calendar, active days, streaks, hour chart): with no project filter, stats-cache is used for dates ≤ `lastComputedDate` and rollups for later dates (stats-cache trails by about a day, so today always comes from rollups); hours likewise from `hourCounts` plus the `startHour` of sessions starting after `lastComputedDate`. With a project filter only rollups are used, and the Overview notes "retained transcripts only". Every day series is in **messages**; API calls appear only as a KPI and in Models.
- Range filters on `days` keys of rollups and on stats-cache dates. A file counts if any of its days falls in range; its per-day messages/calls are filtered exactly, model/tool/skill counts are counted whole for that file (rollups do not split them by day; good enough for 7d/30d).
- stats-cache's `hourCounts` and `longestSession` have no dates, so they are used only for the `all` range; 7d/30d build the hour chart from rollups and leave the longest session out. Archived models are always all-time.
- `project` filter limits every tab to that project's rollups and prompts.
- "First seen" = the earliest of stats-cache `firstSessionDate`, any rollup `startDay`, and the first `history.jsonl` prompt.
- Produces one object per tab, matching the boards:
  - **Overview:** KPIs (sessions, messages, API calls, est. $, models live/archived, projects with/without transcripts), messages per active day, model mix by $, top 4 projects, top 4 tools, top 3 skills, insights.
  - **Models:** per model calls, in, out, cache read, cache write, hit % = `cr / (cr + cw + in)`, $/call, $; call share; archived rows; cost split (input/output/cache read/cache write) for the top model; main vs agent split.
  - **Projects:** grouped by parent folder (`~/STS`, `~/Projects`, other), worktrees nested; prompts, sessions, calls, $, last active; selected-project detail (share, models, branches).
  - **Tools & skills:** tool counts (log-scaled bars), skills with source (`built-in` / `yours` / plugin name), installed-but-never-invoked skills, subagent types.
  - **Plugins & MCP:** every installed plugin with status and usage; MCP servers seen in calls or configured, with per-tool counts for the selected server.
  - **Timeline:** active days, current/longest streak, longest session, average gap, calendar (16 weeks), sessions by hour, Claude Code versions (first/last seen; the newest is "current"; a version still seen after a newer one is flagged), biggest days.
- **Insights:** at most 1 per tab, rule-based, each with a threshold so nothing is shown when it is not true: top model ≥ 60% of $; cache read ≥ 50% of top model $; one tool ≥ 60% of calls; `Edit` = 0 while `Bash` > 100; idle plugins ≥ 5; ≥ 50% of sessions in one hour; top project ≥ 60% of $.

## View: `/dash all`

- `/dash all` toggles a pane `session-dash-all` (separate from the sidebar `session-dash`): `$.ui.open({ id: 'session-dash-all', title: 'Usage', columns: 110, focus: true, closeOnEscape: true })` — 110 columns when docked, inline above the prompt otherwise. `/dash` and `/dash statusline` keep working as today; `/dash all` is added to the command description.
- On open: render immediately from the last index on disk (or a "building index…" line if none), run `history.py index` in the background, re-read and re-render when it finishes. Footer shows `indexed N files · T s · K skipped`.
- Keys are what the engine gives a pane: `Button` hotkeys (single characters, only while the pane has focus; clicks anytime), arrows scroll (engine-owned), Esc closes (`closeOnEscape`). So: tabs are Buttons with hotkeys `1`–`6`; `r` cycles range 7d → 30d → all; on Projects each row is a Button (click, or Tab to it and Enter) that sets the project filter for all tabs; `x` clears it. The board mockups' ←/→ and ↑/↓ hints become these keys.
- **State:** atoms `allTab` (1–6), `allRange`, `allProject` (string or null), `allStatus` (last indexer report or error line) and `allRev` (a counter). The loaded index and extras live in a module variable (they are large and rebuilt from disk on reload); the in-flight flag too. When the indexer finishes, the mod re-reads the files and bumps `allRev`, which redraws the pane.
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

- **Python** `tests/py/test_history.py` (run with `python3 -m unittest discover -s tests/py`): fixture transcripts covering duplicate message ids, `<synthetic>`, top-level `agent-*.jsonl` and `subagents/` files, a file with two `cwd`s, worktree `cwd`, missing `cwd`, bad JSON line, unpriced model, `Skill`/`Agent`/`mcp__` tool uses; incremental run (unchanged file not re-parsed, changed file re-parsed, deleted file kept as `pruned`); version mismatch → rebuild. `cost.py` keeps producing the same totals after the price-table move.
- **TypeScript** `tests/history.test.ts` (`claude plugin test`): `aggregate` for range and project filters, worktree grouping, archived models/days from stats-cache, plugin status, streaks, version flags, each insight rule on and off.
- **Views** `tests/views.test.tsx`: `/dash all` opens the `session-dash-all` pane; each tab renders from a fixture `Dash` at 160 and 80 columns; empty index renders the "building" state.

## Rollout

Bump session-dash to 0.3.0, update README (`/dash all`, the index file, what is and is not counted), push, `/plugin marketplace update drprockz-mods`.
