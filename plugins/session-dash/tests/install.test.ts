import { describe, expect, test } from 'claude-code/testing'

import { BUNDLE, binDir, planStatusLine, STATUS_LINE_COMMAND, withStatusLine } from '../hooks/lib/install'

describe('install', () => {
  test('prices.py ships first, so a partial copy never strands cost.py', () => {
    expect(BUNDLE[0]).toBe('prices.py')
    expect([...BUNDLE].sort()).toEqual(['cost.py', 'history.py', 'prices.py', 'statusline.sh'])
  })
  test('a machine with no status line gets ours', () => {
    expect(planStatusLine(undefined)).toBe('set')
    expect(planStatusLine(null)).toBe('set')
  })
  test('ours is recognised, someone else is left alone', () => {
    expect(planStatusLine({ type: 'command', command: STATUS_LINE_COMMAND })).toBe('ours')
    expect(planStatusLine({ type: 'command', command: 'bash ~/.claude/session-dash/bin/statusline.sh' })).toBe('ours')
    expect(planStatusLine({ type: 'command', command: 'bash ~/.claude/statusline-command.sh' })).toBe('other')
    expect(planStatusLine({ type: 'static' })).toBe('other')
  })
  test('the status line is added and every other key kept', () => {
    const out = JSON.parse(withStatusLine('{"model":"opus","env":{"A":"1"},"statusLine":{"type":"command","command":"x"}}'))
    expect(out.model).toBe('opus')
    expect(out.env).toEqual({ A: '1' })
    expect(out.statusLine).toEqual({ type: 'command', command: STATUS_LINE_COMMAND })
  })
  test('an empty or missing settings file becomes one holding the status line', () => {
    expect(JSON.parse(withStatusLine(''))).toEqual({ statusLine: { type: 'command', command: STATUS_LINE_COMMAND } })
  })
  test('a settings file that is not an object is refused, not overwritten', () => {
    expect(() => withStatusLine('[1]')).toThrow()
    expect(() => withStatusLine('{not json')).toThrow()
  })
  test('the scripts live in one stable folder', () => {
    expect(binDir('/home/me')).toBe('/home/me/.claude/session-dash/bin')
  })
})
