import { describe, expect, test } from 'claude-code/testing'

import * as A from '../hooks/lib/agents'
import { groupOf, groups, segments } from '../hooks/lib/breakdown'
import { dur, hbar, num, prettyModel, stamp, tok, truncMid, usd, usdWhole } from '../hooks/lib/format'
import { effortDots, groupPills, pills } from '../hooks/lib/meter'
import { addSample, evenFraction, paceOf } from '../hooks/lib/pace'
import { C, heat, LEDGER, levelColor } from '../hooks/lib/palette'
import { agentColor, DESK_H, DESK_W, deskPixels, toCells } from '../hooks/lib/office'
import { heartbeat, labelFor, parsePeer, tildify } from '../hooks/lib/peers'
import { DEFAULT_COLOR, rasterCells, resample, sparkGlyph } from '../hooks/lib/spark'

const MIN = 60_000
const HOUR = 60 * MIN

describe('format', () => {
  test('durations', () => {
    expect(dur(0)).toBe('—')
    expect(dur(24_000)).toBe('24s')
    expect(dur(72_000)).toBe('1m12s')
    expect(dur(3 * MIN)).toBe('3m')
    expect(dur(34 * MIN)).toBe('34m')
    expect(dur(72 * MIN)).toBe('1h 12m')
    expect(dur(98 * HOUR)).toBe('4d 2h')
  })
  test('tokens and cost', () => {
    expect(tok(999)).toBe('999')
    expect(tok(1234)).toBe('1.2k')
    expect(tok(84_000)).toBe('84k')
    expect(tok(1_200_000)).toBe('1.2M')
    expect(tok(1_000_000)).toBe('1M')
    expect(usd(4.123)).toBe('$4.12')
    expect(usd(undefined)).toBe('—')
  })
  test('truncation and model names', () => {
    expect(truncMid('abcdefghij', 7)).toBe('abc…hij')
    expect(truncMid('short', 7)).toBe('short')
    expect(prettyModel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(prettyModel('claude-haiku-5-5[1m]')).toBe('Haiku 5.5')
  })
  test('reset stamps in IST, 12-hour', () => {
    const now = Date.parse('2026-10-09T12:00:00Z') // 5:30 PM IST
    expect(stamp(Date.parse('2026-10-09T13:00:00Z'), now)).toBe('6:30 PM')
    expect(stamp(Date.parse('2026-10-09T06:45:00Z'), now)).toBe('12:15 PM')
    // 20:00 UTC is already the next day in IST
    expect(stamp(Date.parse('2026-10-09T20:00:00Z'), now)).toBe('tomorrow 1:30 AM')
    expect(stamp(Date.parse('2026-10-14T09:00:00Z'), now)).toBe('Wed 14 Oct, 2:30 PM')
    expect(stamp(Date.parse('2026-10-11T18:40:00Z'), now)).toBe('Mon 12 Oct, 12:10 AM')
  })
  test('whole dollars', () => {
    expect(usdWhole(1489.08)).toBe('$1,489')
    expect(usdWhole(12)).toBe('$12')
    expect(usdWhole(1234567)).toBe('$1,234,567')
  })
  test('level colors', () => {
    expect(levelColor(69)).toBe(C.ok)
    expect(levelColor(70)).toBe(C.watch)
    expect(levelColor(90)).toBe(C.hot)
  })
})

describe('meter', () => {
  test('heat scale', () => {
    expect(heat(0.5)).toBe(C.ok)
    expect(heat(0.9)).toBe(C.watch)
    expect(heat(1)).toBe(C.hot)
    const lit = pills(1, 10).filter(r => r.text.includes('▰'))
    expect(lit[0]!.color).toBe(C.ok)
    expect(lit[lit.length - 1]!.color).not.toBe(C.ok)
  })
  test('pills light by tens and mark the pace point', () => {
    const t = (f: number, n: number, tick?: number) => pills(f, n, tick).map(r => r.text).join('')
    expect(t(0.46, 10)).toBe('▰▰▰▰▰▱▱▱▱▱')
    expect(t(0.45, 10, 0.25)).toBe('▰▰◆▰▰▱▱▱▱▱')
    expect(t(0.1, 10, 0.5)).toBe('▰▱▱▱▱◇▱▱▱▱')
    expect(t(1, 4)).toBe('▰▰▰▰')
    expect(groupPills([{ color: '#111111', count: 2 }, { color: '#222222', count: 1 }], 5).map(r => r.text).join('')).toBe('▰▰▰▱▱')
  })
  test('effort dots', () => {
    expect(effortDots('high')).toEqual({ on: '●●●', off: '○○' })
    expect(effortDots('max')).toEqual({ on: '●●●●●', off: '' })
    expect(effortDots('')).toEqual({ on: '', off: '○○○○○' })
  })
})

describe('spark', () => {
  test('glyphs by level', () => {
    expect([0, 50, 100].map(sparkGlyph).join('')).toBe('▁▅█')
  })
  test('resamples with carry-forward', () => {
    const s = [
      { t: 10, pct: 20 },
      { t: 55, pct: 40 },
    ]
    expect(resample(s, 4, 0, 100)).toEqual([20, 20, 40, 40])
    expect(resample([{ t: 60, pct: 5 }], 4, 0, 100)).toEqual([undefined, undefined, 5, 5])
  })
  test('raster cells round-trip', () => {
    const b64 = rasterCells([{ ch: '█', fg: 0xff8800 }])
    const bin = atob(b64)
    const bytes = Uint8Array.from(bin, ch => ch.charCodeAt(0))
    const v = new DataView(bytes.buffer)
    expect(v.getUint32(0, true)).toBe(0x2588)
    expect(v.getUint32(4, true)).toBe(0xff8800)
    expect(v.getUint32(8, true)).toBe(DEFAULT_COLOR)
  })
})

describe('pace', () => {
  const t0 = 1_000_000_000
  test('unknown without enough history', () => {
    const w = addSample(undefined, { t: t0, pct: 10 })
    expect(paceOf(w, t0 + 2 * MIN, 12).state).toBe('unknown')
  })
  test('ahead when it would fill before reset', () => {
    let w = addSample(undefined, { t: t0, pct: 60 }, t0 + 2 * HOUR)
    w = addSample(w, { t: t0 + 30 * MIN, pct: 80 }, t0 + 2 * HOUR)
    const p = paceOf(w, t0 + 30 * MIN, 80, t0 + 2 * HOUR)
    expect(p.state).toBe('ahead')
    if (p.state === 'ahead') expect(Math.round(p.toFullMs / MIN)).toBe(30)
  })
  test('on pace when slow', () => {
    let w = addSample(undefined, { t: t0, pct: 10 }, t0 + 4 * HOUR)
    w = addSample(w, { t: t0 + 30 * MIN, pct: 11 }, t0 + 4 * HOUR)
    expect(paceOf(w, t0 + 30 * MIN, 11, t0 + 4 * HOUR).state).toBe('on')
  })
  test('a reset clears samples', () => {
    let w = addSample(undefined, { t: t0, pct: 60 }, t0 + HOUR)
    w = addSample(w, { t: t0 + 10 * MIN, pct: 70 }, t0 + HOUR)
    w = addSample(w, { t: t0 + 70 * MIN, pct: 2 }, t0 + 6 * HOUR)
    expect(w.samples).toEqual([{ t: t0 + 70 * MIN, pct: 2 }])
  })
  test('keeps an anchor older than 30 min', () => {
    let w = addSample(undefined, { t: t0, pct: 10 })
    w = addSample(w, { t: t0 + 40 * MIN, pct: 11 })
    expect(w.samples.length).toBe(2)
    expect(w.samples[0]!.t).toBe(t0)
  })
  test('even-pace fraction', () => {
    expect(evenFraction('five_hour', t0, t0 + 2.5 * HOUR)).toBe(0.5)
    expect(evenFraction('spend_limit', t0, t0 + HOUR)).toBeUndefined()
  })
})

describe('agents', () => {
  const at = 1_000_000
  test('spawn, tools, done', () => {
    let s = A.spawn(A.EMPTY, { id: 'a', type: 'Explore', description: 'find', at })
    for (const t of ['Read', 'Grep', 'Glob', 'Read']) s = A.tool(s, 'a', t, at + 1)
    s = A.complete(s, 'a', 'answer', at + 5, 31_000)
    const a = s.list[0]!
    expect(a.tools).toBe(4)
    expect(a.lastTools).toEqual(['Grep', 'Glob', 'Read'])
    expect(a.status).toBe('done')
    expect(a.outTok).toBe(31_000)
  })
  test('error, aborted and refusal fail', () => {
    for (const r of ['error', 'aborted', 'refusal']) {
      let s = A.spawn(A.EMPTY, { id: 'a', type: 't', description: 'd', at })
      s = A.complete(s, 'a', r, at + 1)
      expect(s.list[0]!.status).toBe('failed')
    }
  })
  test('silent agents go lost, finished ones expire', () => {
    let s = A.spawn(A.EMPTY, { id: 'a', type: 't', description: 'd', at })
    s = A.spawn(s, { id: 'b', type: 't', description: 'd', at })
    s = A.complete(s, 'b', 'answer', at)
    s = A.sweep(s, at + 31 * MIN)
    expect(s.list.map(a => a.id)).toEqual(['a'])
    expect(s.list[0]!.status).toBe('lost')
  })
  test('workflow agents roll up by run', () => {
    let s = A.nameRun(A.EMPTY, 'tu1', 'review-changes')
    for (const id of ['w1', 'w2', 'w3']) {
      s = A.spawn(s, { id, type: 'general', description: id, at, runId: 'wf_1', toolUseId: 'tu1' })
    }
    s = A.complete(s, 'w1', 'answer', at + 1)
    s = A.complete(s, 'w2', 'error', at + 1)
    s = A.spawn(s, { id: 'x', type: 'Plan', description: 'plan', at: at - 1 })
    const { rows } = A.rows(s)
    expect(rows.length).toBe(2)
    const run = rows.find(r => r.kind === 'run')
    expect(run).toEqual(
      expect.objectContaining({ name: 'review-changes', done: 1, failed: 1, running: 1 }),
    )
    expect(A.counts(s)).toEqual({ agents: 1, runs: 1, running: 2 })
  })
  test('row cap puts running first', () => {
    let s = A.EMPTY
    for (let i = 0; i < 8; i++) {
      s = A.spawn(s, { id: `a${i}`, type: 't', description: 'd', at: at + i })
      if (i < 4) s = A.complete(s, `a${i}`, 'answer', at + 10)
    }
    const r = A.rows(s, 6)
    expect(r.more).toBe(2)
    expect(r.rows.slice(0, 4).every(x => x.kind === 'agent' && x.agent.status === 'running')).toBe(true)
  })
  test('workflow names', () => {
    expect(A.workflowName({ name: 'nightly' })).toBe('nightly')
    expect(
      A.workflowName({ script: "export const meta = {\n  name: 'review-changes',\n  description: 'x' }" }),
    ).toBe('review-changes')
    expect(A.workflowName({})).toBe('workflow')
  })
})

describe('breakdown', () => {
  test('groups by name, unknown to other', () => {
    expect(groupOf('Messages')).toBe('messages')
    expect(groupOf('System tools')).toBe('tools')
    expect(groupOf('MCP tools')).toBe('tools')
    expect(groupOf('System prompt')).toBe('system')
    expect(groupOf('Memory files')).toBe('memory')
    expect(groupOf('Skills')).toBe('skills')
    expect(groupOf('Custom agents')).toBe('other')
    const g = groups([
      { name: 'Messages', tokens: 100, kind: 'used' },
      { name: 'Free space', tokens: 900, kind: 'free' },
      { name: 'System tools', tokens: 20, kind: 'used' },
      { name: 'MCP tools', tokens: 30, kind: 'used' },
    ])
    expect(g).toEqual([
      { key: 'messages', tokens: 100 },
      { key: 'tools', tokens: 50 },
    ])
  })
  test('segments add up to the fill exactly', () => {
    const gs = [
      { key: 'messages' as const, tokens: 210 },
      { key: 'tools' as const, tokens: 42 },
      { key: 'system' as const, tokens: 18 },
      { key: 'memory' as const, tokens: 6 },
    ]
    for (const p of [1, 38, 77, 100]) {
      const seg = segments(gs, p, 30)
      expect(seg.reduce((s, x) => s + x.cells, 0)).toBe(Math.round((p / 100) * 30))
    }
    expect(segments(gs, undefined, 30)).toEqual([])
  })
})

describe('peers', () => {
  const now = Date.parse('2026-10-09T12:00:00Z')
  const beat = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      v: 1,
      sessionId: 's2',
      label: 'FORGE',
      cwd: '~/cruz/forge',
      model: 'Opus 5.5',
      isBusy: true,
      agentsRunning: 2,
      costUsd: 1.8,
      updatedAt: '2026-10-09T11:59:00Z',
      ...over,
    })
  test('parses a live peer', () => {
    expect(parsePeer(beat(), 's1', now)).toEqual(
      expect.objectContaining({ label: 'FORGE', agentsRunning: 2, isBusy: true }),
    )
  })
  test('skips own, stale and corrupt', () => {
    expect(parsePeer(beat(), 's2', now)).toBeUndefined()
    expect(parsePeer(beat({ updatedAt: '2026-10-09T11:40:00Z' }), 's1', now)).toBeUndefined()
    expect(parsePeer('{"v":1,"sess', 's1', now)).toBeUndefined()
    expect(parsePeer('[]', 's1', now)).toBeUndefined()
  })
  test('round-trips its own heartbeat', () => {
    const p = parsePeer(beat(), 's1', now)!
    expect(parsePeer(heartbeat(p), 's1', now)).toEqual(p)
  })
  test('labels and paths', () => {
    expect(labelFor('  QT ', '/x')).toBe('QT')
    expect(labelFor(undefined, '/Users/me/cruz/forge/')).toBe('FORGE')
    expect(tildify('/Users/me/cruz', '/Users/me')).toBe('~/cruz')
    expect(tildify('/Users/meow', '/Users/me')).toBe('/Users/meow')
  })
})

describe('office', () => {
  test('a desk is 12×8 pixels and folds into 12×4 cells', () => {
    const px = deskPixels('a1', 'Explore', 'running', 0)
    expect(px.length).toBe(DESK_H)
    expect(px.every(r => r.length === DESK_W)).toBe(true)
    expect(toCells(px).length).toBe(DESK_W * (DESK_H / 2))
  })
  test('typing alternates frames; finished agents sit still', () => {
    const f0 = JSON.stringify(deskPixels('a1', 'Explore', 'running', 0))
    const f1 = JSON.stringify(deskPixels('a1', 'Explore', 'running', 1))
    expect(f0).not.toBe(f1)
    const d0 = JSON.stringify(deskPixels('a1', 'Explore', 'done', 0))
    expect(d0).toBe(JSON.stringify(deskPixels('a1', 'Explore', 'done', 1)))
  })
  test('the screen says how it went', () => {
    const screen = (s: 'running' | 'done' | 'failed') => deskPixels('a1', 'Plan', s, 1)[2]![8]
    expect(screen('running')).toBe(agentColor('Plan'))
    expect(screen('done')).toBe(C.ok)
    expect(screen('failed')).toBe(C.hot)
  })
  test('cells pack top and bottom pixels', () => {
    const cells = toCells([['#FF0000', undefined], ['#00FF00', '#0000FF']])
    expect(cells[0]).toEqual({ ch: '▀', fg: 0xff0000, bg: 0x00ff00 })
    expect(cells[1]).toEqual({ ch: '▄', fg: 0x0000ff, bg: DEFAULT_COLOR })
  })
})

describe('ledger helpers', () => {
  test('hbar fills with eighth blocks and never overflows', () => {
    expect(hbar(1, 4)).toBe('████')
    expect(hbar(0, 4)).toBe('    ')
    expect(hbar(0.5, 4)).toBe('██  ')
    expect(hbar(0.3, 4)).toBe('█▎  ') // 1.2 cells: one full, 1.6 eighths rounds to 2
    expect(hbar(2, 3)).toBe('███')
    expect(hbar(Number.NaN, 2)).toBe('  ')
  })
  test('num groups thousands', () => {
    expect(num(1925)).toBe('1,925')
    expect(num(12)).toBe('12')
  })
  test('ledger reserves amber for money', () => {
    expect(LEDGER.money).toBe('#F5A524')
  })
})
