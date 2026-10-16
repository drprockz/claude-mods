import { describe, expect, test } from 'claude-code/testing'

import {
  parseIndex,
  parsePrompts,
  parseStats,
  pickPlugins,
  pluginInfo,
  reportLine,
  splitWorktree,
} from '../hooks/lib/history-data'
import { aggregate } from '../hooks/lib/history'
import { insights } from '../hooks/lib/insights'
import type { Extras, HistoryIndex, ModelRoll, Rollup } from '../hooks/lib/history-data'

describe('history-data', () => {
  test('index: only v1 with sessions is accepted', () => {
    expect(parseIndex('{"v":1,"builtAt":"x","tz":"+05:30","sessions":{}}')?.tz).toBe('+05:30')
    expect(parseIndex('{"v":0,"sessions":{}}')).toBeNull()
    expect(parseIndex('{nope')).toBeNull()
    expect(parseIndex('')).toBeNull()
  })

  test('stats-cache', () => {
    const s = parseStats(
      JSON.stringify({
        lastComputedDate: '2026-10-15',
        firstSessionDate: '2026-07-03T04:44:45.187Z',
        totalSessions: 178,
        totalMessages: 8401,
        dailyActivity: [{ date: '2026-09-18', messageCount: 5106, sessionCount: 146, toolCallCount: 1 }],
        modelUsage: { 'claude-sonnet-5': { inputTokens: 1, outputTokens: 2, cacheReadInputTokens: 3, cacheCreationInputTokens: 4 } },
        hourCounts: { '12': 150 },
        longestSession: { sessionId: 's', duration: 7_200_000, messageCount: 906, timestamp: '2026-08-21T06:07:51.041Z' },
      }),
    )!
    expect(s.daily['2026-09-18']).toEqual({ m: 5106, s: 146 })
    expect(s.modelTokens['claude-sonnet-5']).toEqual({ total: 10, out: 2 })
    expect(s.hours[12]).toBe(150)
    expect(s.longest).toEqual({ messages: 906, ms: 7_200_000, at: '2026-08-21' })
    expect(s.firstDay).toBe('2026-07-03')
    expect(parseStats('[]')).toBeNull()
  })

  test('prompts: epoch ms, bad lines skipped', () => {
    const t = '{"project":"/a","timestamp":1771309719439}\nnot json\n{"project":"/b"}\n'
    expect(parsePrompts(t)).toEqual([{ project: '/a', at: 1771309719439 }])
  })

  test('worktrees fold into their repo', () => {
    expect(splitWorktree('/h/STS/api/.worktrees/fix-1')).toEqual({ project: '/h/STS/api', worktree: 'fix-1' })
    expect(splitWorktree('/h/STS/api/worktrees/x/sub')).toEqual({ project: '/h/STS/api', worktree: 'x' })
    expect(splitWorktree('/h/STS/api')).toEqual({ project: '/h/STS/api', worktree: null })
  })

  test('installed plugins: name before @, user scope wins', () => {
    const t = JSON.stringify({
      version: 2,
      plugins: {
        'afk@drprockz-afk-marketplace': [
          { scope: 'project', installPath: '/p/afk-proj' },
          { scope: 'user', installPath: '/p/afk' },
        ],
        'playwright@claude-plugins-official': [{ scope: 'project', installPath: '/p/pw' }],
      },
    })
    expect(pickPlugins(t)).toEqual([
      { name: 'afk', marketplace: 'drprockz-afk-marketplace', path: '/p/afk' },
      { name: 'playwright', marketplace: 'claude-plugins-official', path: '/p/pw' },
    ])
    expect(pickPlugins('{bad')).toEqual([])
  })

  test('a plugin that ships only hooks or LSP is background', () => {
    const base = { name: 'x', marketplace: 'm', skills: [], agents: [], commands: [], mcp: [] }
    expect(pluginInfo({ ...base, root: ['hooks', '.claude-plugin'], pluginJson: '{}', mcpJson: '' }).background).toBe(true)
    expect(pluginInfo({ ...base, root: ['.claude-plugin'], pluginJson: '{"lspServers":{}}', mcpJson: '' }).background).toBe(true)
    const pw = pluginInfo({ ...base, root: ['.mcp.json'], pluginJson: '{}', mcpJson: '{"playwright":{"command":"npx"}}' })
    expect(pw.background).toBe(false)
    expect(pw.mcp).toEqual(['playwright'])
    const wrapped = pluginInfo({ ...base, root: ['.mcp.json'], pluginJson: '{}', mcpJson: '{"mcpServers":{"a":{},"b":{}}}' })
    expect(wrapped.mcp).toEqual(['a', 'b'])
    expect(pluginInfo({ ...base, skills: ['afk'], root: ['skills', 'hooks'], pluginJson: '{}', mcpJson: '' }).background).toBe(false)
  })

  test('indexer report line', () => {
    expect(reportLine('{"ok":true,"files":599,"changed":3,"skipped":0,"ms":412}')).toBe('indexed 599 files · 0.4s · 0 skipped')
    expect(reportLine('garbage')).toBe('indexed')
  })
})

const NOW = Date.parse('2026-10-16T10:00:00+05:30')

const model = (calls: number, usd: number, extra: Partial<ModelRoll> = {}): ModelRoll => ({
  calls,
  in: 0,
  out: 0,
  cr: 0,
  cw: 0,
  usd,
  usdParts: { in: 0, out: 0, cr: usd, cw: 0 },
  agentCalls: 0,
  agentUsd: 0,
  ...extra,
})

const roll = (over: Partial<Rollup>): Rollup => ({
  sessionId: 's',
  agentFile: false,
  pruned: false,
  cwd: '/home/me/STS/app',
  project: '/home/me/STS/app',
  worktree: null,
  start: '2026-10-16T09:00:00+05:30',
  end: '2026-10-16T09:30:00+05:30',
  startDay: '2026-10-16',
  startHour: 9,
  versions: { '2.1.301': 1 },
  branches: {},
  models: {},
  tools: {},
  skills: {},
  agents: {},
  mcp: {},
  commands: {},
  days: { '2026-10-16': { m: 10, c: 2 } },
  unpriced: [],
  skipped: 0,
  ...over,
})

const INDEX: HistoryIndex = {
  v: 1,
  builtAt: '',
  tz: '+05:30',
  sessions: {
    a: roll({ sessionId: 's1', models: { 'claude-opus-5': model(8, 90) }, tools: { Bash: 900, Read: 20 }, skills: { 'superpowers:brainstorming': 2, 'anthropic-skills:docs': 1, 'code-review': 3 }, branches: { 'feat/x': 5 } }),
    b: roll({ sessionId: 's1', agentFile: true, models: { 'claude-haiku-4-5-20251001': model(4, 2, { agentCalls: 4, agentUsd: 2 }) }, agents: { Explore: 1 } }),
    c: roll({ sessionId: 's2', project: '/home/me/STS/api', cwd: '/home/me/STS/api/.worktrees/fix', worktree: 'fix', startDay: '2026-09-01', startHour: 12, start: '2026-09-01T12:00:00+05:30', end: '2026-09-01T12:10:00+05:30', days: { '2026-09-01': { m: 6, c: 1 } }, models: { 'claude-opus-5': model(1, 8) }, versions: { '2.0.77': 3 }, pruned: true, mcp: { claude_ai_Atlassian_Rovo: { search: 2 } }, commands: { afk: 1 } }),
  },
}

const EXTRAS: Extras = {
  home: '/home/me',
  stats: {
    lastDay: '2026-10-15',
    firstDay: '2026-07-03',
    totalSessions: 50,
    totalMessages: 900,
    daily: { '2026-07-03': { m: 100, s: 1 }, '2026-09-01': { m: 6, s: 1 }, '2026-10-14': { m: 30, s: 2 }, '2026-10-15': { m: 40, s: 3 } },
    modelTokens: { 'claude-sonnet-5': { total: 1000, out: 10 }, 'claude-opus-5': { total: 5, out: 1 } },
    hours: Array.from({ length: 24 }, (_, h) => (h === 12 ? 9 : 0)),
    longest: { messages: 906, ms: 3_600_000, at: '2026-08-21' },
  },
  prompts: [
    { project: '/home/me/STS/api/.worktrees/fix', at: NOW - 1000 },
    { project: '/home/me/Projects/old', at: Date.parse('2026-02-01T00:00:00Z') },
  ],
  plugins: [
    { name: 'superpowers', marketplace: 'sp', skills: ['brainstorming'], agents: [], commands: [], mcp: [], background: false },
    { name: 'afk', marketplace: 'd', skills: ['afk'], agents: [], commands: [], mcp: [], background: false },
    { name: 'session-dash', marketplace: 'd', skills: [], agents: [], commands: [], mcp: [], background: true },
    { name: 'playwright', marketplace: 'o', skills: [], agents: [], commands: [], mcp: ['playwright'], background: false },
  ],
  userSkills: ['reviewing-merge-requests'],
}

const all = (over = {}) => aggregate(INDEX, EXTRAS, { range: 'all', project: null, now: NOW, ...over })

describe('aggregate', () => {
  test('overview: stats-cache up to its last day, rollups after', () => {
    const o = all().overview
    // 100 + 6 + 30 + 40 from stats-cache, then 2026-10-16 from rollups a+b
    expect(o.messages).toBe(176 + 20)
    expect(o.sessions).toBe(7 + 1) // stats daily sessions, + s1 starting today
    expect(o.calls).toBe(13)
    expect(o.usd).toBe(100)
    expect(o.days.at(-1)).toEqual({ day: '2026-10-16', m: 20 })
    expect(o.retainedOnly).toBe(false)
    expect(o.liveModels).toBe(2)
    expect(o.archivedModels).toBe(1)
    expect(o.projects).toBe(3) // app, api, Projects/old (prompts only)
    expect(o.projectsWithTranscripts).toBe(1) // api's only rollup is pruned
  })

  test('range 7d drops older days and files', () => {
    const o = all({ range: '7d' }).overview
    expect(o.messages).toBe(70 + 20)
    expect(o.calls).toBe(12)
  })

  test('range 30d', () => {
    const o = all({ range: '30d' }).overview
    expect(o.messages).toBe(70 + 20) // 1 Sep is outside 17 Sep – 16 Oct
    expect(o.calls).toBe(12)
  })

  test('a version still seen after a newer one started is stale', () => {
    const late = roll({ sessionId: 's3', versions: { '2.0.77': 1 }, start: '2026-10-16T09:05:00+05:30', end: '2026-10-16T09:20:00+05:30' })
    const d = aggregate({ ...INDEX, sessions: { ...INDEX.sessions, d: late } }, EXTRAS, { range: 'all', project: null, now: NOW })
    expect(d.timeline.versions.find(v => v.v === '2.0.77')!.stale).toBe(true)
  })

  test('hours and longest session are all-time only on the all range', () => {
    const t = all({ range: '7d' }).timeline
    expect(t.hours[12]).toBe(0)
    expect(t.hours[9]).toBe(1)
    expect(t.longest).toBeNull()
  })

  test('project filter uses rollups only and marks it', () => {
    const d = all({ project: '/home/me/STS/api' })
    expect(d.overview.retainedOnly).toBe(true)
    expect(d.overview.messages).toBe(6)
    expect(d.overview.calls).toBe(1)
    expect(d.projects.find(p => p.project === '/home/me/STS/api')?.prompts).toBe(1)
  })

  test('models: hit rate, per call, archived, cost split, agent share', () => {
    const m = all().models
    const opus = m.rows.find(r => r.model === 'claude-opus-5')!
    expect(opus.calls).toBe(9)
    expect(Math.abs(opus.perCall - 98 / 9) < 1e-9).toBe(true)
    expect(m.rows[0]!.model).toBe('claude-opus-5') // sorted by $
    expect(m.rows.find(r => r.model.includes('haiku'))!.agentCalls).toBe(4)
    expect(m.archived).toEqual([{ model: 'claude-sonnet-5', total: 1000, out: 10 }])
    expect(m.split!.cr).toBe(98)
  })

  test('projects: grouped by parent folder, worktrees nested, sorted by $', () => {
    const p = all().projects
    expect(p.map(r => r.project)).toEqual(['/home/me/STS/app', '/home/me/STS/api', '/home/me/Projects/old'])
    expect(p[0]!.group).toBe('~/STS')
    expect(p[1]!.worktrees).toEqual([{ name: 'fix', prompts: 1, calls: 1, usd: 8 }])
    expect(p[0]!.sessions).toBe(1) // a and b are one session
    expect(p[0]!.branches).toEqual([{ name: 'feat/x', n: 5 }])
    expect(p[2]!.calls).toBe(0)
  })

  test('tools, skills by source, unused skills, agents, commands', () => {
    const t = all().tools
    expect(t.tools[0]).toEqual({ name: 'Bash', n: 900 })
    expect(t.skills).toEqual([
      { name: 'code-review', source: 'built-in', n: 3 },
      { name: 'superpowers:brainstorming', source: 'superpowers', n: 2 },
      { name: 'anthropic-skills:docs', source: 'claude.ai', n: 1 },
    ])
    expect(t.unused).toEqual(['reviewing-merge-requests']) // afk:afk counts as used through /afk
    expect(t.agents).toEqual([{ name: 'Explore', n: 1 }])
    expect(t.commands).toEqual([{ name: 'afk', n: 1 }])
  })

  test('plugins: used via skills or commands, background, idle; MCP servers', () => {
    const p = all().plugins
    const by = Object.fromEntries(p.plugins.map(x => [x.name, x]))
    expect(by.superpowers).toMatchObject({ status: 'used', uses: 2 })
    expect(by.afk).toMatchObject({ status: 'used', uses: 1 })
    expect(by['session-dash']!.status).toBe('background')
    expect(by.playwright!.status).toBe('idle')
    expect(p.mcp[0]).toEqual({ server: 'claude_ai_Atlassian_Rovo', kind: 'claude.ai', calls: 2, tools: [{ name: 'search', n: 2 }] })
    expect(p.mcp.find(s => s.server === 'plugin_playwright_playwright')).toMatchObject({ kind: 'plugin', calls: 0 })
  })

  test('a plugin with a skill and a command of one name counts each use once', () => {
    const plugins = EXTRAS.plugins.map(p => (p.name === 'afk' ? { ...p, commands: ['afk'] } : p))
    const p = aggregate(INDEX, { ...EXTRAS, plugins }, { range: 'all', project: null, now: NOW }).plugins
    expect(p.plugins.find(x => x.name === 'afk')).toMatchObject({ status: 'used', uses: 1 })
  })

  test('timeline: streaks, gaps, hours, versions', () => {
    const t = all().timeline
    expect(t.active).toBe(5)
    expect(t.streak).toBe(3) // 14, 15, 16 Oct
    expect(t.longestStreak).toBe(3)
    expect(t.hours[12]).toBe(9)
    expect(t.hours[9]).toBe(1) // s1 starts today, after stats-cache's last day
    expect(t.calendar.length).toBe(16 * 7)
    expect(t.calendar.at(-1)!.day >= '2026-10-16').toBe(true)
    expect(t.versions[0]).toMatchObject({ v: '2.1.301', current: true })
    expect(t.versions.find(v => v.v === '2.0.77')!.stale).toBe(false)
    expect(t.biggest[0]).toEqual({ day: '2026-07-03', m: 100 })
    expect(t.longest?.messages).toBe(906)
    expect(t.firstSeen).toBe('2026-02-01')
  })
})

describe('insights', () => {
  test('each rule fires above its threshold', () => {
    const i = insights(all())
    expect(i.overview).toBe('claude-opus-5 is 98% of est. spend')
    expect(i.models).toBe('Re-reading cached context is 100% of claude-opus-5’s cost. Shorter sessions or /compact cut it most.')
    expect(i.tools).toBe('0 Edit calls and 900 Bash calls: file changes are going through Bash.')
    expect(i.timeline).toBe('90% of sessions start between 12:00 and 13:00')
    expect(i.projects).toBe('/home/me/STS/app is 92% of est. spend')
  })

  test('quiet when nothing crosses a threshold', () => {
    const d = all()
    const calm = {
      ...d,
      models: { ...d.models, rows: [], split: null },
      tools: { ...d.tools, tools: [{ name: 'Read', n: 5 }, { name: 'Edit', n: 5 }] },
      plugins: { ...d.plugins, plugins: [] },
      projects: [],
      timeline: { ...d.timeline, hours: Array<number>(24).fill(1) },
    }
    expect(insights(calm)).toEqual({})
  })

  test('one tool over 60% when Edit is in use', () => {
    const d = all()
    expect(insights({ ...d, tools: { ...d.tools, tools: [{ name: 'Read', n: 70 }, { name: 'Edit', n: 30 }] } }).tools).toBe('Read is 70% of tool calls')
  })

  test('idle plugins', () => {
    const d = all()
    const idle = Array.from({ length: 5 }, (_, k) => ({ name: `p${k}`, marketplace: 'm', status: 'idle' as const, uses: 0 }))
    expect(insights({ ...d, plugins: { ...d.plugins, plugins: idle } }).plugins).toBe('5 of 5 plugins have no recorded use.')
  })
})
