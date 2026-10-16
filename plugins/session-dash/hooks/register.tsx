import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, Register, SessionRateLimit, Timer } from 'claude-code'

import type { Peer, Usage } from '../types'
import * as A from './lib/agents'
import { groups } from './lib/breakdown'
import { dur, prettyModel } from './lib/format'
import { BUNDLE, binDir, planStatusLine, withStatusLine } from './lib/install'
import type { StatusLinePlan } from './lib/install'
import { addSample } from './lib/pace'
import { heartbeat, labelFor, parsePeer, REAP_MS, tildify } from './lib/peers'
import { live, swallow } from './state'
import type { DashData } from './view/dash'
import { Dash, Strip } from './view/dash'

// ── State ───────────────────────────────────────────────────────────

const PANE = 'session-dash'

const activeAtom = atom({ plugin: 'session-dash', key: 'active' } as const, false)
const usageAtom = atom({ plugin: 'session-dash', key: 'usage' } as const, null)
const modelAtom = atom({ plugin: 'session-dash', key: 'model' } as const, '')
const effortAtom = atom({ plugin: 'session-dash', key: 'effort' } as const, '')
const paceAtom = atom({ plugin: 'session-dash', key: 'pace' } as const, {})
const historyAtom = atom({ plugin: 'session-dash', key: 'history' } as const, [])
const turnAtom = atom({ plugin: 'session-dash', key: 'turn' } as const, null)
const totalsAtom = atom({ plugin: 'session-dash', key: 'totals' } as const, { turns: 0, inTok: 0, outTok: 0 })
const busyAtom = atom({ plugin: 'session-dash', key: 'busy' } as const, false)
const agentsAtom = atom({ plugin: 'session-dash', key: 'agents' } as const, A.EMPTY)
const groupsAtom = atom({ plugin: 'session-dash', key: 'groups' } as const, [])
const loadoutAtom = atom({ plugin: 'session-dash', key: 'loadout' } as const, null)
const peersAtom = atom({ plugin: 'session-dash', key: 'peers' } as const, [])
const foldsAtom = atom({ plugin: 'session-dash', key: 'folds' } as const, {})
const tickAtom = atom({ plugin: 'session-dash', key: 'tick' } as const, 0)
const alertedAtom = atom({ plugin: 'session-dash', key: 'alerted' } as const, [])
const monthAtom = atom({ plugin: 'session-dash', key: 'month' } as const, null)
const effortsAtom = atom({ plugin: 'session-dash', key: 'efforts' } as const, {})
const modelIdAtom = atom({ plugin: 'session-dash', key: 'modelId' } as const, '')
const autoOpenedAtom = atom({ plugin: 'session-dash', key: 'autoOpened' } as const, false)

// ── Alerts ──────────────────────────────────────────────────────────

const LABEL: Record<string, string> = { five_hour: '5h', seven_day: '7d' }
const STORE_KEY = 'alerted'

// One alert per threshold per window. Limit keys carry the window's reset
// time and live in the store, so a new session in the same window stays
// quiet; the context key re-arms once the context drops below 80%.
const checkAlerts = async ($: EngineInterface, u: Usage) => {
  const now = await $.clock.now()
  const stored = await $.store.get(STORE_KEY)
  const seen = new Set<string>(Array.isArray(stored) ? (stored as string[]) : [])
  const before = seen.size
  for (const l of u.limits) {
    const label = LABEL[l.kind]
    if (!label) continue
    const at = l.resetsAt ?? 0
    const resets = l.resetsAt ? ` · resets in ${dur(l.resetsAt - now)}` : ''
    if (l.pct >= 90 && !seen.has(`${l.kind}:90:${at}`)) {
      seen.add(`${l.kind}:90:${at}`).add(`${l.kind}:80:${at}`)
      $.ui.toast(`${label} limit at ${Math.round(l.pct)}%${resets}`, { timeoutMs: 8000 })
      swallow($.ui.notify(`${label} limit at ${Math.round(l.pct)}%${resets}`, { title: 'Claude usage' }))
    } else if (l.pct >= 80 && !seen.has(`${l.kind}:80:${at}`)) {
      seen.add(`${l.kind}:80:${at}`)
      $.ui.toast(`${label} limit at ${Math.round(l.pct)}%${resets}`)
    }
  }
  if (seen.size !== before) {
    const keep = [...seen].filter(k => {
      const at = Number(k.split(':')[2])
      return !(at > 0 && at < now)
    })
    await $.store.set(STORE_KEY, keep)
  }

  const ctx = u.ctxPct
  const alerted = await read($, alertedAtom)
  if (ctx !== undefined && ctx >= 85 && !alerted.includes('ctx')) {
    await update($, alertedAtom, a => [...a, 'ctx'])
    $.ui.toast(`Context at ${Math.round(ctx)}% · compact from /dash or /compact`)
  } else if (ctx !== undefined && ctx < 80 && alerted.includes('ctx')) {
    await update($, alertedAtom, a => a.filter(k => k !== 'ctx'))
  }
}

// ── Heartbeat, peers and the spinner clock ──────────────────────────

const POLL_MS = 5000
const SPIN_MS = 500
const KEEPALIVE_MS = 60_000

let poll: Timer | undefined
let spin: Timer | undefined
let lastBody = ''
let lastWrite = 0
let isDirReady = false

const dir = () => `${live.home}/.claude/session-dash/sessions`

// Writes this session's heartbeat when what it says changed, and at least
// once a minute so other sessions keep seeing it as live.
const writeBeat = async ($: EngineInterface, now: number) => {
  if (!live.home) return
  if (!isDirReady) {
    await $.process.run(['mkdir', '-p', dir()])
    isDirReady = true
  }
  const id = await $.session.id()
  const usage = await read($, usageAtom)
  const peer: Peer = {
    sessionId: id,
    label: live.label,
    cwd: tildify(live.cwd, live.home),
    model: await read($, modelAtom),
    isBusy: await read($, busyAtom),
    agentsRunning: A.counts(await read($, agentsAtom)).running,
    costUsd: usage?.costUsd,
    updatedAt: now,
  }
  const body = heartbeat({ ...peer, updatedAt: 0 })
  if (body === lastBody && now - lastWrite < KEEPALIVE_MS) return
  await $.fs.write(`${dir()}/${id}.json`, heartbeat(peer))
  lastBody = body
  lastWrite = now
}

const readPeers = async ($: EngineInterface, now: number) => {
  if (!live.home) return
  const self = await $.session.id()
  let entries
  try {
    entries = await $.fs.list(dir())
  } catch {
    return
  }
  const peers: Peer[] = []
  const reap: string[] = []
  for (const f of entries) {
    if (f.kind !== 'file' || !f.name.endsWith('.json') || f.name === `${self}.json`) continue
    const path = `${dir()}/${f.name}`
    if (now - f.mtimeMs > REAP_MS) {
      reap.push(path)
      continue
    }
    try {
      const p = parsePeer(await $.fs.read(path), self, now)
      if (p) peers.push(p)
    } catch {
      // unreadable: skip this file
    }
  }
  peers.sort((a, b) => Number(b.isBusy) - Number(a.isBusy) || b.updatedAt - a.updatedAt)
  await update($, peersAtom, () => peers)
  if (reap.length) swallow($.process.run(['rm', '-f', ...reap]))
}

// The month's API-equivalent cost by model, kept fresh by the status line's
// background run of session-dash/bin/cost.py, and each model's effort
// setting ('*' holds the default for models without their own).
const readMonth = async ($: EngineInterface) => {
  if (!live.home) return
  try {
    const j = JSON.parse(await $.fs.read(`${live.home}/.claude/session-dash/month-cost.json`)) as Record<string, unknown>
    if (typeof j.month === 'string' && typeof j.usd === 'number') {
      const byModel: Record<string, number> = {}
      if (j.by_model && typeof j.by_model === 'object') {
        for (const [k, v] of Object.entries(j.by_model as Record<string, unknown>)) {
          if (typeof v === 'number') byModel[k] = v
        }
      }
      const next = { month: j.month, usd: j.usd, byModel }
      const prev = await read($, monthAtom)
      if (JSON.stringify(prev) !== JSON.stringify(next)) await update($, monthAtom, () => next)
    }
  } catch {
    // no cache yet
  }
  try {
    const s = await $.settings.read()
    const efforts: Record<string, string> = {}
    if (typeof s.effortLevel === 'string') efforts['*'] = s.effortLevel
    const per = s.modelSettings
    if (per && typeof per === 'object') {
      for (const [id, v] of Object.entries(per as Record<string, unknown>)) {
        const level = v && typeof v === 'object' ? (v as Record<string, unknown>).effortLevel : undefined
        if (typeof level === 'string') efforts[id] = level
      }
    }
    const prev = await read($, effortsAtom)
    if (JSON.stringify(prev) !== JSON.stringify(efforts)) await update($, effortsAtom, () => efforts)
  } catch {
    // settings unreadable: keep the last known efforts
  }
}

// Opens the sidebar once per session, unasked, only where it docks as a
// sidebar (a fullscreen terminal), unless SESSION_DASH_AUTOOPEN=0.
const autoOpen = async ($: EngineInterface) => {
  if (!live.sawFullscreen || (await read($, autoOpenedAtom))) return
  await update($, autoOpenedAtom, () => true)
  if ((await $.env.get('SESSION_DASH_AUTOOPEN')) !== '0') swallow(openDash($))
}

const pollOnce = async ($: EngineInterface) => {
  const now = await $.clock.now()
  await update($, agentsAtom, s => A.sweep(s, now))
  await writeBeat($, now)
  await readPeers($, now)
  await readMonth($)
  await autoOpen($)
}

const startClocks = ($: EngineInterface) => {
  poll?.cancel()
  swallow(pollOnce($))
  poll = $.clock.every(POLL_MS, () => swallow(pollOnce($)))
  syncSpinner($)
}

// The spinner frame advances only while some agent runs.
const syncSpinner = ($: EngineInterface) => {
  swallow(
    (async () => {
      const isRunning = A.counts(await read($, agentsAtom)).running > 0
      if (isRunning && !spin) {
        spin = $.clock.every(SPIN_MS, () => {
          swallow(
            (async () => {
              const s = await read($, agentsAtom)
              if (A.counts(s).running === 0) {
                spin?.cancel()
                spin = undefined
              }
              await update($, tickAtom, t => (t + 1) % 1_000_000)
            })(),
          )
        })
      }
    })(),
  )
}

// ── Collection ──────────────────────────────────────────────────────

const HISTORY_MS = 6 * 60 * 60_000
const HISTORY_KEY = 'history5h'

type U = { context: { tokens?: number; window: number; percent?: number }; rateLimits: SessionRateLimit[]; cost?: { usd: number } }

const toUsage = (u: U, startedAt: number): Usage => ({
  startedAt,
  ctxTokens: u.context.tokens,
  ctxWindow: u.context.window,
  ctxPct: u.context.percent,
  limits: u.rateLimits.map(r => ({
    kind: r.kind,
    pct: r.percentUsed,
    resetsAt: r.resetsAt ? Date.parse(r.resetsAt) : undefined,
  })),
  costUsd: u.cost?.usd,
})

const record = async ($: EngineInterface, u: Usage) => {
  const now = await $.clock.now()
  await update($, usageAtom, () => u)
  await update($, paceAtom, pace => {
    const next = { ...pace }
    for (const l of u.limits) next[l.kind] = addSample(pace[l.kind], { t: now, pct: l.pct }, l.resetsAt)
    return next
  })
  const five = u.limits.find(l => l.kind === 'five_hour')
  if (five) {
    const hist = await update($, historyAtom, h => {
      const last = h[h.length - 1]
      if (last && last.pct === five.pct && now - last.t < 2 * 60_000) return h
      return [...h, { t: now, pct: five.pct }].filter(s => now - s.t <= HISTORY_MS).slice(-360)
    })
    await $.store.set(HISTORY_KEY, hist)
  }
  await checkAlerts($, u)
}

const refreshBreakdown = async ($: EngineInterface) => {
  const u = await $.session.usage({ breakdown: 'summary' })
  const b = u.context.breakdown
  if (!b) return
  await update($, groupsAtom, () => groups(b.categories))
  const fm = b.skills?.skillFrontmatter ?? []
  await update($, loadoutAtom, () => ({
    skills: b.skills?.totalSkills ?? fm.length,
    userSkills: fm.filter(s => !s.pluginName && !/bundled|built-?in|managed/i.test(s.source)).length,
    plugins: live.plugins,
    mcp: new Set(b.mcpTools.map(t => t.serverName)).size,
    agents: b.agents.length,
  }))
}

const seed = async ($: EngineInterface, cwd: string) => {
  live.cwd = cwd
  live.home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
  live.label = labelFor(await $.env.get('SESSION_DASH_LABEL'), cwd)
  try {
    const text = await $.fs.read(`${live.home}/.claude/plugins/installed_plugins.json`)
    const plugins = (JSON.parse(text) as { plugins?: Record<string, unknown> }).plugins
    live.plugins = plugins ? Object.keys(plugins).length : 0
  } catch {
    live.plugins = 0
  }
  const stored = await $.store.get(HISTORY_KEY)
  if (Array.isArray(stored)) await update($, historyAtom, () => stored)
  const folds = await $.store.get('folds')
  if (folds && typeof folds === 'object') {
    await update($, foldsAtom, () => folds as Record<string, boolean>)
  }
  const u = await $.session.usage()
  await record($, toUsage(u, u.startedAt))
  await refreshBreakdown($)
}

// ── Status line install ─────────────────────────────────────────────

const run = async ($: EngineInterface, args: string[]) => {
  const r = await $.process.run(args)
  if (r.exitCode !== 0) throw new Error(`${args[0]} exited ${r.exitCode}`)
}

// Copies the bundled scripts to the stable folder when they differ, so an
// update of the plugin updates the status line too.
export const installBundle = async ($: EngineInterface, home: string) => {
  const dst = binDir(home)
  const changed: string[] = []
  for (const f of BUNDLE) {
    const src = await $.fs.read(`${$.plugin.root}/bin/${f}`)
    let cur: string | undefined
    try {
      cur = await $.fs.read(`${dst}/${f}`)
    } catch {
      // not installed yet
    }
    if (cur !== src) {
      await $.fs.write(`${dst}/${f}`, src)
      changed.push(`${dst}/${f}`)
    }
  }
  if (changed.length) await run($, ['chmod', '755', ...changed])
}

// Points the user's status line at the bundled one: by itself when none is
// set, over another one only when forced. The file is replaced atomically,
// keeping its mode, with the previous text saved beside it.
export const ensureStatusLine = async ($: EngineInterface, home: string, force: boolean): Promise<StatusLinePlan> => {
  const plan = planStatusLine((await $.settings.read({ source: 'user' })).statusLine)
  if (plan === 'ours' || (plan === 'other' && !force)) return plan
  const path = `${home}/.claude/settings.json`
  let text = ''
  try {
    text = await $.fs.read(path)
  } catch {
    // no user settings yet
  }
  const next = withStatusLine(text)
  if (text) await $.fs.write(`${path}.bak-session-dash`, text)
  const tmp = `${path}.session-dash.tmp`
  await $.fs.write(tmp, next)
  await run($, ['chmod', '600', tmp])
  await run($, ['mv', '-f', tmp, path])
  return plan
}

// The bundled status line and cost script, installed once a session knows
// its home. A first install on a machine also sets the status line, when
// none was set; a failure here costs the status line, never the dashboard.
const setup = async ($: EngineInterface) => {
  if (!live.home) return
  await installBundle($, live.home)
  if ((await ensureStatusLine($, live.home, false)) === 'set') {
    $.ui.toast('session-dash: status line installed')
  }
}

const collect = (on: On) => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await update($, activeAtom, () => e.isInteractive)
    if (e.isInteractive) {
      swallow(seed($, e.cwd).then(() => setup($)))
      startClocks($)
      swallow($.command.register({ name: 'dash', description: 'Toggle the session dashboard sidebar; /dash statusline installs its status line' }))
    }
    return r
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    const prev = await read($, usageAtom)
    await record($, toUsage(e, prev?.startedAt ?? (await $.clock.now())))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) {
      const effort = e.effort === undefined ? '' : String(e.effort)
      swallow(update($, effortAtom, () => effort))
      swallow(update($, modelAtom, () => prettyModel(e.model)))
      swallow(update($, modelIdAtom, () => e.model))
    }
    return yield* next(e)
  })

  on('turn.start', async ($, e, next) => {
    live.turnTools = 0
    live.turnCost = (await read($, usageAtom))?.costUsd
    await update($, busyAtom, () => true)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const at = await $.clock.now()
    if (e.agentId) {
      swallow(update($, agentsAtom, s => A.tool(s, e.agentId!, String(e.tool), at)))
    } else {
      live.turnTools++
      if (String(e.tool) === 'Workflow') {
        const name = A.workflowName(e as unknown as Record<string, unknown>)
        swallow(update($, agentsAtom, s => A.nameRun(s, e.tool_use_id, name)))
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    const at = await $.clock.now()
    if (e.agentId) {
      await update($, agentsAtom, s => A.complete(s, e.agentId!, e.reason, at, e.usage?.output_tokens))
      syncSpinner($)
      return r
    }
    const u = await $.session.usage()
    const cost = u.cost?.usd
    await update($, turnAtom, () => ({
      durationMs: e.durationMs,
      tools: live.turnTools,
      costDelta: cost !== undefined && live.turnCost !== undefined ? cost - live.turnCost : undefined,
    }))
    await update($, totalsAtom, t => ({
      turns: t.turns + 1,
      inTok: t.inTok + (e.usage ? e.usage.input_tokens + e.usage.cache_creation_input_tokens : 0),
      outTok: t.outTok + (e.usage?.output_tokens ?? 0),
    }))
    await update($, busyAtom, () => false)
    swallow(refreshBreakdown($))
    return r
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (r.agentId) {
      const at = await $.clock.now()
      await update($, agentsAtom, s =>
        A.spawn(s, {
          id: r.agentId!,
          type: e.subagentType,
          description: e.description,
          model: r.model,
          at,
          runId: e.workflow?.runId,
          toolUseId: e.tool_use_id,
        }),
      )
      syncSpinner($)
    }
    return r
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, turnAtom, () => null)
      await update($, totalsAtom, () => ({ turns: 0, inTok: 0, outTok: 0 }))
      await update($, agentsAtom, () => A.EMPTY)
      await update($, groupsAtom, () => [])
    }
    if (live.home) {
      swallow($.process.run(['rm', '-f', `${live.home}/.claude/session-dash/sessions/${e.sessionId}.json`]))
    }
    return next(e)
  }).catch(($, e, next) => next(e))
}

// ── Views ───────────────────────────────────────────────────────────

const snapshot = async ($: EngineInterface, width: number, focusAgentId?: string): Promise<DashData> => ({
  now: await $.clock.now(),
  tick: await read($, tickAtom),
  width,
  isBusy: await read($, busyAtom),
  model: await read($, modelAtom),
  modelId: await read($, modelIdAtom),
  effort: await read($, effortAtom),
  usage: await read($, usageAtom),
  pace: await read($, paceAtom),
  history: await read($, historyAtom),
  turn: await read($, turnAtom),
  totals: await read($, totalsAtom),
  agents: await read($, agentsAtom),
  groups: await read($, groupsAtom),
  loadout: await read($, loadoutAtom),
  peers: await read($, peersAtom),
  folds: await read($, foldsAtom),
  month: await read($, monthAtom),
  efforts: await read($, effortsAtom),
  focusAgentId,
})

const openDash = ($: EngineInterface) => $.ui.open({ id: PANE, title: 'Session', columns: 50 })

const toggleFold = async ($: EngineInterface, section: string) => {
  const folds = await update($, foldsAtom, f => ({ ...f, [section]: !f[section] }))
  await $.store.set('folds', folds)
}

const compactNow = async ($: EngineInterface) => {
  try {
    await $.session.compact()
  } catch {
    $.ui.toast('Compact is only possible while Claude is idle')
  }
}

const views = (on: On) => {
  on('command.run', { command: 'dash' }, async ($, e) => {
    if (e.args.trim() === 'statusline') {
      if (!live.home) return { text: 'The session has not started yet.' }
      await installBundle($, live.home)
      const was = await ensureStatusLine($, live.home, true)
      return {
        text:
          was === 'ours'
            ? 'The status line is already session-dash.'
            : 'Status line set to session-dash (previous settings saved as settings.json.bak-session-dash).',
      }
    }
    const mine = (await $.ui.panes()).find(p => p.id === PANE)
    if (mine?.isShown) {
      await $.ui.close({ id: PANE })
      return { text: 'Dashboard closed.' }
    }
    const opened = await openDash($)
    return { text: opened.isPlaced ? 'Dashboard open.' : 'Dashboard waits for a wider terminal.' }
  })

  on('ui.render', { component: 'Pane', requestId: 'session-dash' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const El = $.ui.resolve(e)
    const d = await snapshot($, e.props.bodyColumns, e.props.view.agentId)
    return (
      <Dash
        E={El}
        d={d}
        act={{
          toggle: section => swallow(toggleFold($, section)),
          compact: () => swallow(compactNow($)),
        }}
      />
    )
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || !(await read($, activeAtom)) || e.props.hasSurvey) return next(e)
    const isFullscreen = e.viewport?.isFullscreen === true
    if (isFullscreen) live.sawFullscreen = true
    const agents = await read($, agentsAtom)
    if (A.counts(agents).running === 0) return next(e)
    const mine = (await $.ui.panes()).find(p => p.id === PANE)
    const isDocked = isFullscreen && mine?.isPlaced === true && mine.isShown
    const El = $.ui.resolve(e)
    const d = await snapshot($, e.props.bodyColumns)
    return <Strip E={El} d={d} isDocked={isDocked} onOpen={() => swallow(openDash($))} />
  }).catch(($, e, next) => next(e))
}

export const register: Register = on => {
  collect(on)
  views(on)
}
