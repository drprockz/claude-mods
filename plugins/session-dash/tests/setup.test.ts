import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { STATUS_LINE_COMMAND } from '../hooks/lib/install'

const HOME = '/home/me'
const SETTINGS = `${HOME}/.claude/settings.json`
const BIN = `${HOME}/.claude/session-dash/bin`

const USAGE = { startedAt: 0, context: { tokens: 0, window: 1_000_000, percent: 0 }, rateLimits: [], cost: { usd: 0 } }

// A machine as a map of files, beneath the plugin. mv and chmod act on it;
// the user settings source reads the settings file.
const machine = (on: On, files: Map<string, string>, runs: string[][]) => {
  mock.clock(on, { now: Date.parse('2026-10-12T12:00:00Z') } as never)
  mock.store(on)
  mock.env(on, { HOME })
  on('session.start', (_, e) => ({ cwd: e.cwd }) as never)
  on('command.register', () => ({ value: {} }) as never)
  on('session.usage', () => ({ value: USAGE }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.panes', () => ({ value: [] }) as never)
  on('fs.list', () => {
    throw new Error('ENOENT')
  })
  on('fs.read', (_, e) => {
    if (e.path.includes('/bin/') && !e.path.startsWith(HOME)) return { value: `bundled ${e.path.split('/').pop()}` } as never
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
    const [cmd, , from = '', to = ''] = argv
    if (cmd === 'mv') {
      files.set(to, files.get(from) ?? '')
      files.delete(from)
    }
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
  on('settings.read', () => {
    const t = files.get(SETTINGS)
    return { value: t ? JSON.parse(t) : {} } as never
  })
}

const settle = async () => {
  const { setTimeout } = globalThis as unknown as { setTimeout: (f: () => void, ms: number) => void }
  for (let i = 0; i < 50; i++) await new Promise<void>(r => setTimeout(r, 0))
}

const start = ($: Engine) => $.session.start({ cwd: '/tmp/demo', surface: 'terminal', isInteractive: true })

describe('setup', () => {
  test('a fresh machine gets the scripts and the status line, other settings kept', async ($, on) => {
    const files = new Map([[SETTINGS, '{"model":"opus"}']])
    const runs: string[][] = []
    machine(on, files, runs)
    await start($)
    await settle()
    expect(files.get(`${BIN}/statusline.sh`)).toBe('bundled statusline.sh')
    expect(files.get(`${BIN}/cost.py`)).toBe('bundled cost.py')
    expect(files.get(`${BIN}/prices.py`)).toBe('bundled prices.py')
    expect(files.get(`${BIN}/history.py`)).toBe('bundled history.py')
    const s = JSON.parse(files.get(SETTINGS)!)
    expect(s.model).toBe('opus')
    expect(s.statusLine).toEqual({ type: 'command', command: STATUS_LINE_COMMAND })
    expect(files.get(`${SETTINGS}.bak-session-dash`)).toBe('{"model":"opus"}')
    expect(runs.some(r => r[0] === 'chmod' && r[1] === '755')).toBe(true)
  })

  test('another status line is left alone until /dash statusline', async ($, on) => {
    const theirs = '{"statusLine":{"type":"command","command":"bash ~/mine.sh"}}'
    const files = new Map([[SETTINGS, theirs]])
    machine(on, files, [])
    await start($)
    await settle()
    expect(files.get(SETTINGS)).toBe(theirs)
    expect(files.get(`${BIN}/statusline.sh`)).toBe('bundled statusline.sh')

    const r = await $.command.run({ command: 'dash', args: 'statusline' } as never)
    expect(JSON.stringify(r)).toContain('Status line set')
    expect(JSON.parse(files.get(SETTINGS)!).statusLine.command).toBe(STATUS_LINE_COMMAND)
    expect(files.get(`${SETTINGS}.bak-session-dash`)).toBe(theirs)
  })

  test('scripts already current are not rewritten', async ($, on) => {
    const files = new Map([
      [SETTINGS, JSON.stringify({ statusLine: { type: 'command', command: STATUS_LINE_COMMAND } })],
      [`${BIN}/statusline.sh`, 'bundled statusline.sh'],
      [`${BIN}/cost.py`, 'bundled cost.py'],
      [`${BIN}/prices.py`, 'bundled prices.py'],
      [`${BIN}/history.py`, 'bundled history.py'],
    ])
    const runs: string[][] = []
    machine(on, files, runs)
    await start($)
    await settle()
    expect(runs.some(r => r[0] === 'chmod' || r[0] === 'mv')).toBe(false)
    expect(files.has(`${SETTINGS}.bak-session-dash`)).toBe(false)
  })
})
