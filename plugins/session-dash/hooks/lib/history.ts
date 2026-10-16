import type { Extras, HistoryIndex, Parts, Rollup } from './history-data'
import { splitWorktree } from './history-data'

// Everything /dash all draws, for one range and project. Pure: the caller
// reads the files; this only counts. Day series use stats-cache up to its
// last computed day (it survives transcript pruning) and rollups after it;
// with a project filter only rollups can say which project a day belongs to.

export type Range = '7d' | '30d' | 'all'
export type Opts = { range: Range; project: string | null; now: number }
export type TabId = 'overview' | 'models' | 'projects' | 'tools' | 'plugins' | 'timeline'

export type ModelRow = {
  model: string
  calls: number
  in: number
  out: number
  cr: number
  cw: number
  usd: number
  agentCalls: number
  agentUsd: number
  hit: number
  perCall: number
  share: number
}

export type ProjectRow = {
  project: string
  group: string
  prompts: number
  sessions: number
  calls: number
  usd: number
  last: string | null
  worktrees: { name: string; prompts: number; calls: number; usd: number }[]
  branches: { name: string; n: number }[]
  models: { model: string; calls: number }[]
}

export type Counted = { name: string; n: number }

export type HistoryDash = {
  range: Range
  project: string | null
  today: string
  files: number
  pruned: number
  overview: {
    sessions: number
    messages: number
    calls: number
    usd: number
    liveModels: number
    archivedModels: number
    projects: number
    projectsWithTranscripts: number
    days: { day: string; m: number }[]
    retainedOnly: boolean
  }
  models: {
    rows: ModelRow[]
    archived: { model: string; total: number; out: number }[]
    split: Parts | null
    unpriced: string[]
  }
  projects: ProjectRow[]
  tools: {
    tools: Counted[]
    skills: { name: string; source: string; n: number }[]
    unused: string[]
    agents: Counted[]
    commands: Counted[]
  }
  plugins: {
    plugins: { name: string; marketplace: string; status: 'used' | 'background' | 'idle'; uses: number }[]
    mcp: { server: string; kind: 'plugin' | 'claude.ai' | 'local'; calls: number; tools: Counted[] }[]
  }
  timeline: {
    active: number
    streak: number
    longestStreak: number
    avgGap: number | null
    calendar: { day: string; m: number }[]
    hours: number[]
    versions: { v: string; first: string; last: string; current: boolean; stale: boolean }[]
    biggest: { day: string; m: number }[]
    longest: { messages: number; ms: number; at: string } | null
    firstSeen: string | null
  }
}

const DAY = 86_400_000

const tzMinutes = (tz: string) => {
  const m = /^([+-])(\d\d):(\d\d)$/.exec(tz)
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0
}
const dayOf = (ms: number, tzMin: number) => new Date(ms + tzMin * 60_000).toISOString().slice(0, 10)
const addDays = (day: string, k: number) => new Date(Date.parse(`${day}T00:00:00Z`) + k * DAY).toISOString().slice(0, 10)
const between = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY)

const add = (m: Record<string, number>, k: string, n: number) => {
  m[k] = (m[k] ?? 0) + n
}
const top = (m: Record<string, number>): Counted[] =>
  Object.entries(m)
    .filter(([, n]) => n > 0)
    .map(([name, n]) => ({ name, n }))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))

const semver = (v: string) => v.split('.').map(x => Number(x) || 0)
const newer = (a: string, b: string) => {
  const [x, y] = [semver(a), semver(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0)
  return 0
}

const groupOf = (project: string, home: string) => {
  if (!home || !project.startsWith(`${home}/`)) return 'Other'
  const rest = project.slice(home.length + 1).split('/')
  return rest.length >= 2 ? `~/${rest[0]}` : 'Other'
}

const skillSource = (name: string, plugins: Set<string>, user: Set<string>) => {
  const at = name.indexOf(':')
  if (at > 0) {
    const p = name.slice(0, at)
    if (p === 'anthropic-skills') return 'claude.ai'
    return plugins.has(p) ? p : 'built-in'
  }
  return user.has(name) ? 'yours' : 'built-in'
}

export const aggregate = (index: HistoryIndex, x: Extras, o: Opts): HistoryDash => {
  const tzMin = tzMinutes(index.tz)
  const today = dayOf(o.now, tzMin)
  const from = o.range === 'all' ? '' : addDays(today, o.range === '7d' ? -6 : -29)
  const inRange = (d: string) => d >= from && d <= today
  const all = Object.values(index.sessions)
  const ofProject = (r: Rollup) => !o.project || r.project === o.project
  const scope = all.filter(r => ofProject(r) && Object.keys(r.days).some(inRange))
  const prompts = x.prompts
    .map(p => ({ ...p, ...splitWorktree(p.project), day: dayOf(p.at, tzMin) }))
    .filter(p => (!o.project || p.project === o.project) && inRange(p.day))

  // ── day series ────────────────────────────────────────────────────
  const useStats = !o.project && x.stats !== null
  const cut = useStats ? x.stats!.lastDay : ''
  const series: Record<string, { m: number; s: number }> = {}
  if (useStats) for (const [d, v] of Object.entries(x.stats!.daily)) if (inRange(d)) series[d] = { ...v }
  const sessionsByDay: Record<string, Set<string>> = {}
  for (const r of scope) {
    for (const [d, v] of Object.entries(r.days)) {
      if (!inRange(d) || d <= cut) continue
      series[d] = series[d] ?? { m: 0, s: 0 }
      series[d]!.m += v.m
    }
    if (r.startDay && inRange(r.startDay) && r.startDay > cut && !r.agentFile) {
      ;(sessionsByDay[r.startDay] ??= new Set()).add(r.sessionId)
    }
  }
  for (const [d, ids] of Object.entries(sessionsByDay)) (series[d] ??= { m: 0, s: 0 }).s += ids.size
  const days = Object.entries(series)
    .filter(([, v]) => v.m > 0)
    .map(([day, v]) => ({ day, m: v.m }))
    .sort((a, b) => a.day.localeCompare(b.day))

  // ── models ────────────────────────────────────────────────────────
  const mm: Record<string, Omit<ModelRow, 'hit' | 'perCall' | 'share'>> = {}
  const parts: Record<string, Parts> = {}
  const unpriced = new Set<string>()
  for (const r of scope) {
    r.unpriced.forEach(u => unpriced.add(u))
    for (const [id, s] of Object.entries(r.models)) {
      const t = (mm[id] ??= { model: id, calls: 0, in: 0, out: 0, cr: 0, cw: 0, usd: 0, agentCalls: 0, agentUsd: 0 })
      const tp = (parts[id] ??= { in: 0, out: 0, cr: 0, cw: 0 })
      t.calls += s.calls
      t.in += s.in
      t.out += s.out
      t.cr += s.cr
      t.cw += s.cw
      t.usd += s.usd
      t.agentCalls += s.agentCalls
      t.agentUsd += s.agentUsd
      for (const k of ['in', 'out', 'cr', 'cw'] as const) tp[k] += s.usdParts?.[k] ?? 0
    }
  }
  const calls = Object.values(mm).reduce((a, m) => a + m.calls, 0)
  const usd = Object.values(mm).reduce((a, m) => a + m.usd, 0)
  const rows: ModelRow[] = Object.values(mm)
    .map(m => ({
      ...m,
      hit: m.cr + m.cw + m.in > 0 ? m.cr / (m.cr + m.cw + m.in) : 0,
      perCall: m.calls ? m.usd / m.calls : 0,
      share: calls ? m.calls / calls : 0,
    }))
    .sort((a, b) => b.usd - a.usd || b.calls - a.calls)
  const seenModels = new Set(all.flatMap(r => Object.keys(r.models)))
  const archived = useStats
    ? Object.entries(x.stats!.modelTokens)
        .filter(([id]) => !seenModels.has(id))
        .map(([model, t]) => ({ model, total: t.total, out: t.out }))
        .sort((a, b) => b.total - a.total)
    : []
  const split = rows[0] ? { ...parts[rows[0].model]! } : null

  // ── projects ──────────────────────────────────────────────────────
  const pr: Record<string, ProjectRow & { ids: Set<string>; wt: Record<string, { prompts: number; calls: number; usd: number }>; br: Record<string, number>; md: Record<string, number> }> = {}
  const row = (project: string) =>
    (pr[project] ??= { project, group: groupOf(project, x.home), prompts: 0, sessions: 0, calls: 0, usd: 0, last: null, worktrees: [], branches: [], models: [], ids: new Set(), wt: {}, br: {}, md: {} })
  for (const r of scope) {
    const p = row(r.project)
    const c = Object.values(r.models).reduce((a, m) => a + m.calls, 0)
    const u = Object.values(r.models).reduce((a, m) => a + m.usd, 0)
    p.ids.add(r.sessionId)
    p.calls += c
    p.usd += u
    const last = Object.keys(r.days).filter(inRange).sort().at(-1) ?? null
    if (last && (!p.last || last > p.last)) p.last = last
    if (r.worktree) {
      const w = (p.wt[r.worktree] ??= { prompts: 0, calls: 0, usd: 0 })
      w.calls += c
      w.usd += u
    }
    for (const [b, n] of Object.entries(r.branches)) add(p.br, b, n)
    for (const [m, s] of Object.entries(r.models)) add(p.md, m, s.calls)
  }
  for (const q of prompts) {
    const p = row(q.project)
    p.prompts++
    if (q.worktree) (p.wt[q.worktree] ??= { prompts: 0, calls: 0, usd: 0 }).prompts++
    if (!p.last || q.day > p.last) p.last = q.day
  }
  const projects: ProjectRow[] = Object.values(pr)
    .map(({ ids, wt, br, md, ...p }) => ({
      ...p,
      sessions: ids.size,
      worktrees: Object.entries(wt)
        .map(([name, w]) => ({ name, ...w }))
        .sort((a, b) => b.usd - a.usd || b.prompts - a.prompts),
      branches: top(br).slice(0, 3),
      models: top(md).map(c => ({ model: c.name, calls: c.n })),
    }))
    .sort((a, b) => b.usd - a.usd || b.prompts - a.prompts || a.project.localeCompare(b.project))

  // ── tools, skills, agents, commands ───────────────────────────────
  const tools: Record<string, number> = {}
  const skills: Record<string, number> = {}
  const agents: Record<string, number> = {}
  const commands: Record<string, number> = {}
  const mcpCalls: Record<string, Record<string, number>> = {}
  for (const r of scope) {
    for (const [k, n] of Object.entries(r.tools)) add(tools, k, n)
    for (const [k, n] of Object.entries(r.skills)) add(skills, k, n)
    for (const [k, n] of Object.entries(r.agents)) add(agents, k, n)
    for (const [k, n] of Object.entries(r.commands ?? {})) add(commands, k, n)
    for (const [s, t] of Object.entries(r.mcp)) for (const [k, n] of Object.entries(t)) add((mcpCalls[s] ??= {}), k, n)
  }
  const pluginNames = new Set(x.plugins.map(p => p.name))
  const userSkills = new Set(x.userSkills)
  const skillRows = top(skills).map(s => ({ name: s.name, source: skillSource(s.name, pluginNames, userSkills), n: s.n }))
  // a bare name counts for a plugin that ships it; a built-in of the same
  // name would count too, which is rare enough to accept
  const used = (name: string) => (skills[name] ?? 0) + (commands[name] ?? 0)
  const unused = [
    ...x.plugins.flatMap(p => p.skills.map(s => `${p.name}:${s}`)).filter(s => used(s) === 0 && used(s.split(':')[1]!) === 0),
    ...x.userSkills.filter(s => used(s) === 0),
  ].sort()

  // ── plugins and MCP ───────────────────────────────────────────────
  const plugins = x.plugins
    .map(p => {
      let uses = 0
      for (const s of [...p.skills, ...p.commands]) uses += used(`${p.name}:${s}`) + used(s)
      for (const a of p.agents) uses += agents[`${p.name}:${a}`] ?? 0
      for (const s of p.mcp) uses += Object.values(mcpCalls[`plugin_${p.name}_${s}`] ?? {}).reduce((a, n) => a + n, 0)
      const status: 'used' | 'background' | 'idle' = uses > 0 ? 'used' : p.background ? 'background' : 'idle'
      return { name: p.name, marketplace: p.marketplace, status, uses }
    })
    .sort((a, b) => b.uses - a.uses || ['used', 'background', 'idle'].indexOf(a.status) - ['used', 'background', 'idle'].indexOf(b.status) || a.name.localeCompare(b.name))
  const servers = new Set([...Object.keys(mcpCalls), ...x.plugins.flatMap(p => p.mcp.map(s => `plugin_${p.name}_${s}`))])
  const mcp = [...servers]
    .map(server => {
      const t = mcpCalls[server] ?? {}
      return {
        server,
        kind: (server.startsWith('plugin_') ? 'plugin' : server.startsWith('claude_ai_') ? 'claude.ai' : 'local') as 'plugin' | 'claude.ai' | 'local',
        calls: Object.values(t).reduce((a, n) => a + n, 0),
        tools: top(t),
      }
    })
    .sort((a, b) => b.calls - a.calls || a.server.localeCompare(b.server))

  // ── timeline ──────────────────────────────────────────────────────
  const activeDays = days.map(d => d.day)
  const isActive = new Set(activeDays)
  let streak = 0
  for (let d = isActive.has(today) ? today : addDays(today, -1); isActive.has(d); d = addDays(d, -1)) streak++
  let longestStreak = 0
  let run = 0
  let prev = ''
  for (const d of activeDays) {
    run = prev && between(prev, d) === 1 ? run + 1 : 1
    longestStreak = Math.max(longestStreak, run)
    prev = d
  }
  const avgGap = activeDays.length > 1 ? between(activeDays[0]!, activeDays.at(-1)!) / (activeDays.length - 1) : null
  const calStart = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7) - 15 * 7) // Monday, 16 weeks back
  const calendar = Array.from({ length: 16 * 7 }, (_, i) => {
    const day = addDays(calStart, i)
    return { day, m: series[day]?.m ?? 0 }
  })
  // stats-cache's hour counts and longest session are all-time totals with
  // no dates, so they only stand in for the 'all' range
  const allTime = useStats && o.range === 'all'
  const hours = allTime ? [...x.stats!.hours] : Array<number>(24).fill(0)
  for (const r of scope) {
    if (r.agentFile || r.startHour === null || !r.startDay || !inRange(r.startDay)) continue
    if (!allTime || r.startDay > cut) hours[r.startHour] = (hours[r.startHour] ?? 0) + 1
  }
  const vs: Record<string, { first: string; last: string }> = {}
  for (const r of scope) {
    for (const v of Object.keys(r.versions)) {
      const s = (vs[v] ??= { first: r.start ?? '', last: r.end ?? '' })
      if (r.start && r.start < s.first) s.first = r.start
      if (r.end && r.end > s.last) s.last = r.end
    }
  }
  const order = Object.keys(vs).sort((a, b) => newer(b, a))
  const current = order[0]
  const versions = order.map(v => ({
    v,
    first: vs[v]!.first.slice(0, 10),
    last: vs[v]!.last.slice(0, 10),
    current: v === current,
    stale: v !== current && current !== undefined && vs[v]!.last > vs[current]!.first,
  }))
  const firstCandidates = [
    useStats ? x.stats!.firstDay : null,
    ...all.map(r => r.startDay),
    ...x.prompts.map(p => dayOf(p.at, tzMin)),
  ].filter((d): d is string => !!d)

  return {
    range: o.range,
    project: o.project,
    today,
    files: all.length,
    pruned: all.filter(r => r.pruned).length,
    overview: {
      sessions: Object.values(series).reduce((a, v) => a + v.s, 0),
      messages: days.reduce((a, d) => a + d.m, 0),
      calls,
      usd,
      liveModels: rows.length,
      archivedModels: archived.length,
      projects: projects.length,
      projectsWithTranscripts: new Set(scope.filter(r => !r.pruned).map(r => r.project)).size,
      days,
      retainedOnly: !useStats,
    },
    models: { rows, archived, split, unpriced: [...unpriced].sort() },
    projects,
    tools: { tools: top(tools), skills: skillRows, unused, agents: top(agents), commands: top(commands) },
    plugins: { plugins, mcp },
    timeline: {
      active: activeDays.length,
      streak,
      longestStreak,
      avgGap,
      calendar,
      hours,
      versions,
      biggest: [...days].sort((a, b) => b.m - a.m).slice(0, 2),
      longest: allTime ? x.stats!.longest : null,
      firstSeen: firstCandidates.sort()[0] ?? null,
    },
  }
}
