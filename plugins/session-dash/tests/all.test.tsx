import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const HOME = '/home/me'
const C = `${HOME}/.claude`
const now = Date.parse('2026-10-16T10:00:00+05:30')

const ROLL = {
  sessionId: 's1', agentFile: false, pruned: false, cwd: '/home/me/STS/app', project: '/home/me/STS/app', worktree: null,
  start: '2026-10-16T09:00:00+05:30', end: '2026-10-16T09:10:00+05:30', startDay: '2026-10-16', startHour: 9,
  versions: { '2.1.301': 1 }, branches: { main: 1 },
  models: { 'claude-opus-5': { calls: 3, in: 1, out: 2, cr: 3, cw: 4, usd: 1.5, usdParts: { in: 0, out: 0.5, cr: 1, cw: 0 }, agentCalls: 0, agentUsd: 0 } },
  tools: { Bash: 2 }, skills: { 'code-review': 1 }, agents: {}, mcp: {}, commands: {}, days: { '2026-10-16': { m: 6, c: 3 } }, unpriced: [], skipped: 0,
}

const machine = (on: On, files: Map<string, string>, runs: string[][], exitCode = 0) => {
  mock.clock(on, { now } as never)
  mock.store(on)
  mock.env(on, { HOME })
  on('session.start', (_, e) => ({ cwd: e.cwd }) as never)
  on('command.register', () => ({ value: {} }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 0, window: 1, percent: 0 }, rateLimits: [], cost: { usd: 0 } } }) as never)
  on('settings.read', () => ({ value: { statusLine: { type: 'command', command: 'x' } } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.panes', () => ({ value: [] }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['(engine)'] }) as never)
  on('fs.list', () => {
    throw new Error('ENOENT')
  })
  on('fs.read', (_, e) => {
    if (e.path.includes('/bin/') && !e.path.startsWith(HOME)) return { value: 'bundled' } as never
    const t = files.get(e.path)
    if (t === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: t } as never
  })
  on('fs.write', (_, e) => {
    files.set(e.path, e.text)
    return { value: undefined } as never
  })
  on('process.run', (_, e) => {
    const argv = [...e.argv]
    runs.push(argv)
    if (argv.some(a => a.endsWith('history.py'))) {
      if (exitCode === 0) files.set(`${C}/session-dash/history-index.json`, JSON.stringify({ v: 1, builtAt: '', tz: '+05:30', sessions: { f: ROLL } }))
      return { value: { exitCode, stdout: exitCode ? '' : '{"ok":true,"files":1,"changed":1,"skipped":0,"ms":40}', stderr: exitCode ? 'Traceback: boom' : '' } } as never
    }
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
}

const PANE = {
  plugin: 'session-dash',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'session-dash-all',
  viewport: { columns: 200, rows: 60, isFullscreen: true },
  props: { title: 'Usage', isFocused: true, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 58 }, view: {} },
} as const

// session.start seeds HOME in the background and /dash all indexes in the
// background: let both finish before looking
const settle = async () => {
  const { setTimeout } = globalThis as unknown as { setTimeout: (f: () => void, ms: number) => void }
  for (let i = 0; i < 50; i++) await new Promise<void>(r => setTimeout(r, 0))
}

const start = async ($: Engine) => {
  await $.session.start({ cwd: '/tmp/demo', surface: 'terminal', isInteractive: true })
  await settle()
}

const openAll = async ($: Engine) => {
  const r = await $.command.run({ command: 'dash', args: 'all' } as never)
  await settle()
  return r as { text: string }
}

describe('/dash all', () => {
  test('opens the pane, indexes in the background and draws the overview', async ($, on) => {
    const files = new Map<string, string>()
    const runs: string[][] = []
    machine(on, files, runs)
    await start($)
    const r = await openAll($)
    expect(r.text).toMatch(/Usage/)
    expect(runs.some(a => a.join(' ').includes('/home/me/.claude/session-dash/bin/history.py index'))).toBe(true)
    const ui = await $.ui.mount(PANE)
    expect(await ui.find({ type: 'Text', text: 'API CALLS' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /indexed 1 files/ })).toBeDefined()
    await ui.unmount()
  })

  test('tab hotkeys switch tabs and r cycles the range', async ($, on) => {
    machine(on, new Map(), [])
    await start($)
    await openAll($)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'tab-models' })
    expect(await ui.find({ type: 'Text', text: /MAIN THREAD VS SUBAGENTS/ })).toBeDefined()
    for (const [key, text] of [['tab-projects', /PROMPTS/], ['tab-tools', /TOOL CALLS/], ['tab-plugins', /MCP SERVERS/], ['tab-timeline', /CLAUDE CODE VERSIONS/]] as const) {
      await ui.press({ key })
      expect(await ui.find({ type: 'Text', text })).toBeDefined()
    }
    expect(await ui.find({ type: 'Text', text: /r range \(all\)/ })).toBeDefined()
    await ui.press({ key: 'range' })
    expect(await ui.find({ type: 'Text', text: /r range \(7d\)/ })).toBeDefined()
    await ui.unmount()
  })

  test('clicking a project filters every tab; x clears it', async ($, on) => {
    machine(on, new Map(), [])
    await start($)
    await openAll($)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'tab-projects' })
    expect(await ui.find({ type: 'Text', text: /^TOP · / })).toBeDefined()
    await ui.press({ key: 'project-/home/me/STS/app' })
    expect(await ui.find({ key: 'clear-project' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^FILTERED · ~\/STS\/APP/ })).toBeDefined()
    await ui.press({ key: 'clear-project' })
    expect(await ui.find({ key: 'clear-project' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^TOP · / })).toBeDefined()
    await ui.unmount()
  })

  test('indexer failure with no index says so', async ($, on) => {
    machine(on, new Map(), [], 1)
    await start($)
    await openAll($)
    const ui = await $.ui.mount(PANE)
    expect(await ui.find({ type: 'Text', text: /index failed: Traceback: boom/ })).toBeDefined()
    await ui.unmount()
  })

  test('narrow pane asks for room', async ($, on) => {
    machine(on, new Map(), [])
    await start($)
    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 50 } })
    expect(await ui.find({ type: 'Text', text: /wider terminal/ })).toBeDefined()
    await ui.unmount()
  })

  test('before the session has started it says so instead of opening', async ($, on) => {
    const runs: string[][] = []
    machine(on, new Map(), runs)
    const r = await openAll($)
    expect(r.text).toBe('The session has not started yet.')
    expect(runs.some(a => a.join(' ').includes('history.py'))).toBe(false)
  })

  test('a failed reindex over an existing index shows the whole error on its own line', async ($, on) => {
    const index = JSON.stringify({ v: 1, builtAt: '', tz: '+05:30', sessions: { f: ROLL } })
    machine(on, new Map([[`${C}/session-dash/history-index.json`, index]]), [], 1)
    await start($)
    await openAll($)
    const ui = await $.ui.mount(PANE)
    expect(await ui.find({ type: 'Text', text: 'API CALLS' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^index failed: Traceback: boom$/ })).toBeDefined()
    await ui.unmount()
  })

  test('every tab draws at 160 and 80 columns', async ($, on) => {
    machine(on, new Map(), [])
    await start($)
    await openAll($)
    for (const bodyColumns of [160, 80]) {
      const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns } })
      for (const [key, text] of [
        ['tab-overview', /^API CALLS$/],
        ['tab-models', /MAIN THREAD VS SUBAGENTS/],
        ['tab-projects', /PROMPTS/],
        ['tab-tools', /TOOL CALLS/],
        ['tab-plugins', /MCP SERVERS/],
        ['tab-timeline', /CLAUDE CODE VERSIONS/],
      ] as const) {
        await ui.press({ key })
        expect(await ui.find({ type: 'Text', text })).toBeDefined()
      }
      await ui.unmount()
    }
  })

  test('plain /dash still toggles the sidebar', async ($, on) => {
    machine(on, new Map(), [])
    await start($)
    const r = await $.command.run({ command: 'dash', args: '' } as never)
    expect((r as { text: string }).text).toMatch(/Dashboard/)
  })
})
