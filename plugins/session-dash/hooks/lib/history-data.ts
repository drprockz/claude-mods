// The shapes /dash all reads from disk, and pure parsers of each file's
// text. Every parser takes text and never throws: a file that is missing or
// malformed gives an empty value and the rest of the dashboard still draws.

export type Parts = { in: number; out: number; cr: number; cw: number }

export type ModelRoll = {
  calls: number
  in: number
  out: number
  cr: number
  cw: number
  usd: number
  usdParts: Parts
  agentCalls: number
  agentUsd: number
}

// One transcript file, rolled up by bin/history.py.
export type Rollup = {
  sessionId: string
  agentFile: boolean
  pruned: boolean
  cwd: string | null
  project: string
  worktree: string | null
  start: string | null
  end: string | null
  startDay: string | null
  startHour: number | null
  versions: Record<string, number>
  branches: Record<string, number>
  models: Record<string, ModelRoll>
  tools: Record<string, number>
  skills: Record<string, number>
  agents: Record<string, number>
  mcp: Record<string, Record<string, number>>
  commands: Record<string, number>
  days: Record<string, { m: number; c: number }>
  unpriced: string[]
  skipped: number
}

export type HistoryIndex = { v: 1; builtAt: string; tz: string; sessions: Record<string, Rollup> }

export type Stats = {
  lastDay: string
  firstDay: string | null
  totalSessions: number
  totalMessages: number
  daily: Record<string, { m: number; s: number }>
  modelTokens: Record<string, { total: number; out: number }>
  hours: number[]
  longest: { messages: number; ms: number; at: string } | null
}

export type Prompt = { project: string; at: number }

export type PluginInfo = {
  name: string
  marketplace: string
  skills: string[]
  agents: string[]
  commands: string[]
  mcp: string[]
  background: boolean
}

export type Extras = {
  home: string
  stats: Stats | null
  prompts: Prompt[]
  plugins: PluginInfo[]
  userSkills: string[]
}

const obj = (x: unknown): Record<string, unknown> | null =>
  x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : null
const json = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)

export const parseIndex = (text: string): HistoryIndex | null => {
  const j = obj(json(text))
  return j && j.v === 1 && obj(j.sessions) ? (j as unknown as HistoryIndex) : null
}

export const parseStats = (text: string): Stats | null => {
  const j = obj(json(text))
  if (!j || typeof j.lastComputedDate !== 'string') return null
  const daily: Stats['daily'] = {}
  for (const d of Array.isArray(j.dailyActivity) ? j.dailyActivity : []) {
    const o = obj(d)
    if (o && typeof o.date === 'string') daily[o.date] = { m: n(o.messageCount), s: n(o.sessionCount) }
  }
  const modelTokens: Stats['modelTokens'] = {}
  for (const [k, v] of Object.entries(obj(j.modelUsage) ?? {})) {
    const o = obj(v)
    if (!o) continue
    modelTokens[k] = {
      total: n(o.inputTokens) + n(o.outputTokens) + n(o.cacheReadInputTokens) + n(o.cacheCreationInputTokens),
      out: n(o.outputTokens),
    }
  }
  const hours = Array.from({ length: 24 }, (_, h) => n(obj(j.hourCounts)?.[String(h)]))
  const l = obj(j.longestSession)
  return {
    lastDay: j.lastComputedDate,
    firstDay: typeof j.firstSessionDate === 'string' ? j.firstSessionDate.slice(0, 10) : null,
    totalSessions: n(j.totalSessions),
    totalMessages: n(j.totalMessages),
    daily,
    modelTokens,
    hours,
    longest:
      l && typeof l.timestamp === 'string'
        ? { messages: n(l.messageCount), ms: n(l.duration), at: l.timestamp.slice(0, 10) }
        : null,
  }
}

export const parsePrompts = (text: string): Prompt[] => {
  const out: Prompt[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const o = obj(json(line))
    if (o && typeof o.project === 'string' && typeof o.timestamp === 'number') out.push({ project: o.project, at: o.timestamp })
  }
  return out
}

const WORKTREE = /^(.*?)\/\.?worktrees\/([^/]+)/

export const splitWorktree = (path: string): { project: string; worktree: string | null } => {
  const m = WORKTREE.exec(path)
  return m ? { project: m[1]!, worktree: m[2]! } : { project: path, worktree: null }
}

// installed_plugins.json: {"plugins": {"name@marketplace": [{scope, installPath}]}}
export const pickPlugins = (text: string): { name: string; marketplace: string; path: string }[] => {
  const plugins = obj(obj(json(text))?.plugins)
  if (!plugins) return []
  const out: { name: string; marketplace: string; path: string }[] = []
  for (const [id, entries] of Object.entries(plugins)) {
    const list = (Array.isArray(entries) ? entries : []).map(obj).filter(e => e && typeof e.installPath === 'string')
    const pick = list.find(e => e!.scope === 'user') ?? list[0]
    if (!pick) continue
    const at = id.lastIndexOf('@')
    out.push({ name: at > 0 ? id.slice(0, at) : id, marketplace: at > 0 ? id.slice(at + 1) : '', path: pick.installPath as string })
  }
  return out
}

// What a plugin's folder holds, read by the caller; this decides what it is.
export const pluginInfo = (p: {
  name: string
  marketplace: string
  root: string[]
  skills: string[]
  agents: string[]
  commands: string[]
  mcp: string[]
  pluginJson: string
  mcpJson: string
}): PluginInfo => {
  const mj = obj(json(p.mcpJson))
  const servers = mj ? Object.keys(obj(mj.mcpServers) ?? mj) : []
  const pj = obj(json(p.pluginJson)) ?? {}
  const mcp = [...new Set([...p.mcp, ...servers, ...Object.keys(obj(pj.mcpServers) ?? {})])]
  const countable = p.skills.length + p.agents.length + p.commands.length + mcp.length > 0
  const passive = p.root.includes('hooks') || 'hooks' in pj || 'lspServers' in pj || p.root.includes('bin')
  return {
    name: p.name,
    marketplace: p.marketplace,
    skills: p.skills,
    agents: p.agents,
    commands: p.commands,
    mcp,
    background: !countable && passive,
  }
}

export const reportLine = (stdout: string): string => {
  const j = obj(json(stdout.trim()))
  if (!j || j.ok !== true) return 'indexed'
  return `indexed ${n(j.files)} files · ${(n(j.ms) / 1000).toFixed(1)}s · ${n(j.skipped)} skipped`
}
