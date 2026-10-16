import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import { aggregate } from './lib/history'
import type { Range, TabId } from './lib/history'
import type { Extras, HistoryIndex, PluginInfo } from './lib/history-data'
import { parseIndex, parsePrompts, parseStats, pickPlugins, pluginInfo, reportLine } from './lib/history-data'
import { insights } from './lib/insights'
import { binDir } from './lib/install'
import { live, swallow } from './state'
import { History } from './view/history'

// /dash all: the all-time usage pane. bin/history.py keeps the index; this
// loads it with the small files beside it, runs the indexer in the
// background on open, and redraws when it is done.

export const ALL_PANE = 'session-dash-all'

const tabAtom = atom({ plugin: 'session-dash', key: 'allTab' } as const, 'overview')
const rangeAtom = atom({ plugin: 'session-dash', key: 'allRange' } as const, 'all')
const projectAtom = atom({ plugin: 'session-dash', key: 'allProject' } as const, null)
const statusAtom = atom({ plugin: 'session-dash', key: 'allStatus' } as const, '')
const revAtom = atom({ plugin: 'session-dash', key: 'allRev' } as const, 0)

// Large and rebuilt from disk, so module variables rather than state.
const hist = {
  home: '',
  index: null as HistoryIndex | null,
  extras: null as Extras | null,
  isRunning: false,
}

// Every helper given $ is a function declaration: past an import the engine
// follows $ only into those.
function text($: EngineInterface, path: string) {
  return $.fs.read(path).catch(() => '')
}

// FsEntry.kind is 'file' | 'dir' | 'other'; a symlinked skill folder is
// 'other', so folders are anything that is not a plain file
async function names($: EngineInterface, path: string, kind: 'file' | 'dir' | 'any' = 'any') {
  try {
    return (await $.fs.list(path))
      .filter(e => kind === 'any' || (kind === 'file' ? e.kind === 'file' : e.kind !== 'file'))
      .map(e => e.name)
  } catch {
    return []
  }
}

async function readPlugins($: EngineInterface, c: string): Promise<PluginInfo[]> {
  const out: PluginInfo[] = []
  for (const p of pickPlugins(await text($, `${c}/plugins/installed_plugins.json`))) {
    const md = (xs: string[]) => xs.filter(f => f.endsWith('.md')).map(f => f.slice(0, -3))
    out.push(
      pluginInfo({
        name: p.name,
        marketplace: p.marketplace,
        root: await names($, p.path),
        skills: await names($, `${p.path}/skills`, 'dir'),
        agents: md(await names($, `${p.path}/agents`, 'file')),
        commands: md(await names($, `${p.path}/commands`, 'file')),
        mcp: [],
        pluginJson: await text($, `${p.path}/.claude-plugin/plugin.json`),
        mcpJson: await text($, `${p.path}/.mcp.json`),
      }),
    )
  }
  return out
}

async function load($: EngineInterface) {
  const c = `${live.home}/.claude`
  hist.index = parseIndex(await text($, `${c}/session-dash/history-index.json`))
  hist.extras = {
    home: live.home,
    stats: parseStats(await text($, `${c}/stats-cache.json`)),
    prompts: parsePrompts(await text($, `${c}/history.jsonl`)),
    plugins: await readPlugins($, c),
    userSkills: (await names($, `${c}/skills`, 'dir')).filter(n => n !== 'synced'),
  }
}

// the last line: a Python traceback ends with the error itself
const lastLine = (s: string) => s.trim().split('\n').at(-1)?.slice(0, 120) ?? ''

async function reindex($: EngineInterface) {
  if (hist.isRunning || !live.home) return
  hist.isRunning = true
  try {
    const r = await $.process.run(['/usr/bin/env', 'python3', '-I', `${binDir(live.home)}/history.py`, 'index'], { timeoutMs: 120_000 })
    const line = r.exitCode === 0 ? reportLine(r.stdout) : `index failed: ${lastLine(r.stderr || r.stdout) || `exit ${r.exitCode}`}`
    await update($, statusAtom, () => line)
  } catch (err) {
    await update($, statusAtom, () => `index failed: ${lastLine(String(err))}`)
  } finally {
    hist.isRunning = false
  }
  await load($)
  await update($, revAtom, n => n + 1)
}

export async function toggleAll($: EngineInterface): Promise<{ text: string }> {
  const mine = (await $.ui.panes()).find(p => p.id === ALL_PANE)
  if (mine?.isShown) {
    await $.ui.close({ id: ALL_PANE })
    return { text: 'Usage closed.' }
  }
  // a reload or another home (tests) starts from disk again
  if (hist.home !== live.home) Object.assign(hist, { home: live.home, index: null, extras: null, isRunning: false })
  if (!hist.index && live.home) await load($)
  swallow(reindex($))
  const opened = await $.ui.open({ id: ALL_PANE, title: 'Usage', columns: 110, focus: true, closeOnEscape: true })
  return { text: opened.isPlaced ? 'Usage open.' : 'Usage waits for a wider terminal.' }
}

const RANGES: Range[] = ['all', '7d', '30d']

export function registerAll(on: On) {
  on('ui.render', { component: 'Pane', requestId: ALL_PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const El = $.ui.resolve(e)
    await read($, revAtom)
    const tab = (await read($, tabAtom)) as TabId
    const range = (await read($, rangeAtom)) as Range
    const project = await read($, projectAtom)
    const status = await read($, statusAtom)
    const d = hist.index && hist.extras ? aggregate(hist.index, hist.extras, { range, project, now: await $.clock.now() }) : null
    return (
      <History
        E={El}
        w={e.props.bodyColumns}
        d={d}
        tab={tab}
        status={status}
        insight={d ? insights(d)[tab] : undefined}
        home={live.home}
        act={{
          tab: id => swallow(update($, tabAtom, () => id)),
          range: () => swallow(update($, rangeAtom, r => RANGES[(RANGES.indexOf(r as Range) + 1) % RANGES.length]!)),
          project: p => swallow(update($, projectAtom, () => p)),
        }}
      />
    )
  }).catch(($, e, next) => next(e))
}
