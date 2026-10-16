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
