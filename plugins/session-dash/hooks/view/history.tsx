import type { RenderChildren, RenderNode } from 'claude-code'

import type { HistoryDash, TabId } from '../lib/history'
import { hbar, num, prettyModel, tok, truncEnd, usd } from '../lib/format'
import { LEDGER as L, modelColor } from '../lib/palette'
import { cell, Rule } from './ui'
import type { E } from './ui'

export const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'models', label: 'Models' },
  { id: 'projects', label: 'Projects' },
  { id: 'tools', label: 'Tools & skills' },
  { id: 'plugins', label: 'Plugins & MCP' },
  { id: 'timeline', label: 'Timeline' },
]

export type HistoryActions = {
  tab: (id: TabId) => void
  range: () => void
  project: (p: string | null) => void
}

export type HistoryProps = {
  E: E
  w: number
  d: HistoryDash | null
  tab: TabId
  status: string
  insight?: string
  act: HistoryActions
}

const short = (home: string, p: string) => (home && p.startsWith(home) ? `~${p.slice(home.length)}` : p)
const est = (x: number) => (x > 0 ? usd(x) : '—')

const Line = ({ E, children }: { E: E; children: RenderChildren }) => <E.Text wrap="truncate">{children}</E.Text>

const Label = ({ E, text }: { E: E; text: string }) => <E.Text color={L.muted}>{text.toUpperCase()}</E.Text>

// name, a bar, its number: every bar carries its value
const BarRow = (p: { E: E; w: number; name: string; frac: number; value: string; color: string; nameW?: number }) => {
  const nameW = p.nameW ?? Math.min(26, Math.floor(p.w * 0.35))
  const valW = 10
  const barW = Math.max(4, p.w - nameW - valW - 2)
  return (
    <Line E={p.E}>
      <p.E.Text>{cell(p.name, nameW)} </p.E.Text>
      <p.E.Text color={p.color}>{hbar(p.frac, barW)}</p.E.Text>
      <p.E.Text> {cell(p.value, valW - 1, 'right')}</p.E.Text>
    </Line>
  )
}

const Header = ({ E, w, d, tab, act, home }: HistoryProps & { home: string }) => {
  const { Box, Button, Text } = E
  return (
    <Box flexDirection="column" width={w}>
      <Box flexDirection="row" width={w} justifyContent="space-between">
        <Box flexDirection="row">
          <Text bold color={L.money}>/dash all</Text>
          <Text color={L.muted} wrap="truncate">{d?.project ? `  ${short(home, d.project)}  ` : '  every project'}</Text>
          {d?.project ? <Button key="clear-project" plain hotkey="x" label="clear" onPress={() => act.project(null)} /> : null}
        </Box>
        <Button key="range" plain hotkey="r" onPress={act.range}>
          {(['7d', '30d', 'all'] as const).map(r => (
            <Text color={d?.range === r ? L.money : L.muted} bold={d?.range === r}>{` ${r} `}</Text>
          ))}
        </Button>
      </Box>
      <Box flexDirection="row" width={w} flexWrap="wrap">
        {TABS.map((t, i) => (
          <Button key={`tab-${t.id}`} plain hotkey={String(i + 1)} onPress={() => act.tab(t.id)}>
            <Text color={t.id === tab ? L.ink : L.muted} bold={t.id === tab} underline={t.id === tab}>{`${t.label} `}</Text>
          </Button>
        ))}
      </Box>
      <Rule E={E} w={w} />
    </Box>
  )
}

const Overview = ({ E, w, d }: { E: E; w: number; d: HistoryDash }) => {
  const { Box, Text } = E
  const o = d.overview
  const kpis = [
    ['Sessions', num(o.sessions)],
    ['Messages', num(o.messages)],
    ['API calls', num(o.calls)],
    ['Est. cost', est(o.usd)],
    ['Models', `${o.liveModels} + ${o.archivedModels}○`],
    ['Projects', `${o.projects}`],
  ] as const
  const kw = Math.max(12, Math.floor(w / (w >= 100 ? 6 : 3)))
  const max = Math.max(1, ...o.days.map(x => x.m))
  const spark = o.days.slice(-Math.max(8, w - 4)).map(x => '▁▂▃▄▅▆▇█'[Math.min(7, Math.floor((Math.sqrt(x.m) / Math.sqrt(max)) * 7.99))]).join('')
  return (
    <Box flexDirection="column" width={w}>
      <Box flexDirection="row" flexWrap="wrap" width={w}>
        {kpis.map(([k, v]) => (
          <Box flexDirection="column" width={kw} marginBottom={1}>
            <Label E={E} text={k} />
            <Text bold color={k === 'Est. cost' ? L.money : L.ink}>{v}</Text>
          </Box>
        ))}
      </Box>
      <Label E={E} text={`messages per active day · ${o.days.length} days${o.retainedOnly ? ' · retained transcripts only' : ''}`} />
      <Text color={L.count}>{spark || '—'}</Text>
      <Box marginTop={1} flexDirection="column" width={w}>
        <Label E={E} text="model mix · est. $" />
        {d.models.rows.slice(0, 4).map(m => (
          <BarRow E={E} w={w} name={prettyModel(m.model)} frac={o.usd ? m.usd / o.usd : 0} value={est(m.usd)} color={modelColor(m.model)} />
        ))}
      </Box>
      <Box marginTop={1} flexDirection="column" width={w}>
        <Label E={E} text="top projects" />
        {d.projects.slice(0, 4).map(p => (
          <Line E={E}>
            <Text>{cell(p.project.split('/').slice(-1)[0] ?? p.project, Math.floor(w * 0.5))}</Text>
            <Text color={L.muted}>{cell(`${p.sessions} sess`, 10, 'right')}</Text>
            <Text color={L.money}>{cell(est(p.usd), 10, 'right')}</Text>
          </Line>
        ))}
      </Box>
      <Box marginTop={1} flexDirection="column" width={w}>
        <Label E={E} text="top tools · skills" />
        {d.tools.tools.slice(0, 4).map(t => (
          <BarRow E={E} w={w} name={t.name} frac={t.n / Math.max(1, d.tools.tools[0]!.n)} value={num(t.n)} color={L.count} />
        ))}
        {d.tools.skills.slice(0, 3).map(s => (
          <Line E={E}>
            <Text color={L.used}>◆ </Text>
            <Text>{cell(s.name, w - 10)}</Text>
            <Text>{cell(num(s.n), 6, 'right')}</Text>
          </Line>
        ))}
      </Box>
    </Box>
  )
}

const Models = ({ E, w, d }: { E: E; w: number; d: HistoryDash }) => {
  const { Box, Text } = E
  const wide = w >= 100
  const cols = wide
    ? (['Model', 'Calls', 'Input', 'Output', 'Cache rd', 'Cache wr', 'Hit', '$/call', 'Est. $'] as const)
    : (['Model', 'Calls', 'Output', 'Hit', 'Est. $'] as const)
  const nameW = Math.max(14, w - (cols.length - 1) * 10)
  const cellsOf = (m: HistoryDash['models']['rows'][number]) =>
    wide
      ? [num(m.calls), tok(m.in), tok(m.out), tok(m.cr), tok(m.cw), `${Math.round(m.hit * 100)}%`, est(m.perCall), est(m.usd)]
      : [num(m.calls), tok(m.out), `${Math.round(m.hit * 100)}%`, est(m.usd)]
  const s = d.models.split
  const sTotal = s ? s.in + s.out + s.cr + s.cw : 0
  return (
    <Box flexDirection="column" width={w}>
      <Label E={E} text={`share of API calls · ${num(d.overview.calls)}`} />
      <Line E={E}>
        {d.models.rows.slice(0, 5).map(m => (
          <Text color={modelColor(m.model)}>{'█'.repeat(Math.max(m.share > 0 ? 1 : 0, Math.round(m.share * (w - 2))))}</Text>
        ))}
      </Line>
      <Box marginTop={1} flexDirection="column" width={w}>
        <Line E={E}>
          {cols.map((c, i) => (
            <Text color={L.muted}>{i === 0 ? cell(c, nameW) : cell(c, 10, 'right')}</Text>
          ))}
        </Line>
        {d.models.rows.map(m => (
          <Line E={E}>
            <Text color={modelColor(m.model)}>● </Text>
            <Text>{cell(prettyModel(m.model), nameW - 2)}</Text>
            {cellsOf(m).map((v, i, a) => (
              <Text color={i === a.length - 1 ? L.money : L.ink}>{cell(v, 10, 'right')}</Text>
            ))}
          </Line>
        ))}
        {d.models.archived.map(a => (
          <Line E={E}>
            <Text color={L.muted}>{`○ ${cell(prettyModel(a.model), nameW - 2)}${cell(`${tok(a.total)} tokens · archived`, w - nameW, 'right')}`}</Text>
          </Line>
        ))}
        {d.models.unpriced.length ? <Text color={L.muted}>{`no price for ${d.models.unpriced.join(', ')}: tokens only`}</Text> : null}
      </Box>
      {s && sTotal > 0 && d.models.rows[0] ? (
        <Box marginTop={1} flexDirection="column" width={w}>
          <Label E={E} text={`where ${prettyModel(d.models.rows[0].model)}'s ${est(sTotal)} goes`} />
          {(
            [
              ['cache read', s.cr, L.money],
              ['cache write', s.cw, L.warn],
              ['output', s.out, L.count],
              ['input', s.in, L.used],
            ] as const
          ).map(([k, v, c]) => (
            <BarRow E={E} w={w} name={k} frac={v / sTotal} value={`${est(v)} ${Math.round((v / sTotal) * 100)}%`} color={c} />
          ))}
        </Box>
      ) : null}
      <Box marginTop={1} flexDirection="column" width={w}>
        <Label E={E} text="main thread vs subagents · calls" />
        {d.models.rows.slice(0, 4).map(m => (
          <BarRow E={E} w={w} name={prettyModel(m.model)} frac={m.calls ? m.agentCalls / m.calls : 0} value={`${Math.round(m.calls ? (m.agentCalls / m.calls) * 100 : 0)}% agent`} color={L.agent} />
        ))}
      </Box>
    </Box>
  )
}

const Projects = ({ E, w, d, act, home }: { E: E; w: number; d: HistoryDash; act: HistoryActions; home: string }) => {
  const { Box, Button, Text } = E
  const nameW = Math.max(16, w - 42)
  let group = ''
  const rows: RenderNode[] = []
  for (const p of [...d.projects].sort((a, b) => a.group.localeCompare(b.group) || b.usd - a.usd)) {
    if (p.group !== group) {
      group = p.group
      rows.push(<Text color={L.money}>{group.toUpperCase()}</Text>)
    }
    const name = p.project.startsWith(`${home}/`) ? p.project.split('/').slice(-1)[0]! : short(home, p.project)
    rows.push(
      <Button key={`project-${p.project}`} plain onPress={() => act.project(p.project)}>
        <Text wrap="truncate">
          <Text bold={d.project === p.project}>{cell(` ${name}`, nameW)}</Text>
          <Text>{cell(p.prompts ? num(p.prompts) : '—', 8, 'right')}</Text>
          <Text>{cell(p.sessions ? num(p.sessions) : '—', 8, 'right')}</Text>
          <Text>{cell(p.calls ? num(p.calls) : '—', 8, 'right')}</Text>
          <Text color={L.money}>{cell(est(p.usd), 9, 'right')}</Text>
          <Text color={L.muted}>{cell(p.last ? p.last.slice(5) : '', 7, 'right')}</Text>
        </Text>
      </Button>,
    )
    for (const t of p.worktrees) {
      rows.push(
        <Text color={L.muted} wrap="truncate">{`${cell(`   ⎇ ${t.name}`, nameW)}${cell(t.prompts ? num(t.prompts) : '—', 8, 'right')}${cell('', 8)}${cell(t.calls ? num(t.calls) : '—', 8, 'right')}${cell(est(t.usd), 9, 'right')}`}</Text>,
      )
    }
  }
  const sel = d.project ? d.projects.find(p => p.project === d.project) : d.projects[0]
  return (
    <Box flexDirection="column" width={w}>
      <Text color={L.muted} wrap="truncate">{`${cell(' PROJECT', nameW)}${cell('PROMPTS', 8, 'right')}${cell('SESS', 8, 'right')}${cell('CALLS', 8, 'right')}${cell('EST. $', 9, 'right')}${cell('LAST', 7, 'right')}`}</Text>
      {rows}
      <Text color={L.muted}>— = transcripts pruned · prompts from history.jsonl · click a project to filter every tab</Text>
      {sel ? (
        <Box marginTop={1} flexDirection="column" width={w}>
          <Label E={E} text={`${d.project ? 'filtered' : 'top'} · ${short(home, sel.project)}`} />
          {sel.models.slice(0, 4).map(m => (
            <BarRow E={E} w={w} name={prettyModel(m.model)} frac={sel.calls ? m.calls / sel.calls : 0} value={num(m.calls)} color={modelColor(m.model)} />
          ))}
          {sel.branches.map(b => (
            <Text wrap="truncate">
              <Text color={L.used}>⎇ </Text>
              <Text>{truncEnd(b.name, w - 4)}</Text>
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  )
}

const Tools = ({ E, w, d }: { E: E; w: number; d: HistoryDash }) => {
  const { Box, Text } = E
  const t = d.tools
  const lg = Math.log10((t.tools[0]?.n ?? 1) + 1)
  return (
    <Box flexDirection="column" width={w}>
      <Label E={E} text={`tool calls · ${num(t.tools.reduce((a, x) => a + x.n, 0))} · log scale`} />
      {t.tools.slice(0, 15).map(x => (
        <BarRow E={E} w={w} name={x.name} frac={lg ? Math.log10(x.n + 1) / lg : 0} value={num(x.n)} color={x.name === 'mcp' ? L.warn : L.count} />
      ))}
      <Box marginTop={1} flexDirection="column" width={w}>
        <Label E={E} text={`skills invoked · ${num(t.skills.reduce((a, x) => a + x.n, 0))}`} />
        {t.skills.map(s => (
          <Line E={E}>
            <Text color={L.used}>◆ </Text>
            <Text>{cell(s.name, w - 22)}</Text>
            <Text color={L.muted}>{cell(s.source, 14, 'right')}</Text>
            <Text>{cell(num(s.n), 6, 'right')}</Text>
          </Line>
        ))}
        {t.commands.length ? <Label E={E} text="slash commands" /> : null}
        {t.commands.slice(0, 8).map(c => (
          <Line E={E}>
            <Text>{cell(`/${c.name}`, w - 8)}</Text>
            <Text>{cell(num(c.n), 6, 'right')}</Text>
          </Line>
        ))}
        {t.unused.length ? (
          <Box flexDirection="column" width={w}>
            <Label E={E} text={`installed, never invoked · ${t.unused.length}`} />
            <Text color={L.muted} wrap="wrap">{t.unused.join(' · ')}</Text>
          </Box>
        ) : null}
      </Box>
      <Box marginTop={1} flexDirection="column" width={w}>
        <Label E={E} text={`subagents spawned · ${num(t.agents.reduce((a, x) => a + x.n, 0))}`} />
        {t.agents.map(a => (
          <BarRow E={E} w={w} name={a.name} frac={a.n / Math.max(1, t.agents[0]!.n)} value={num(a.n)} color={L.agent} />
        ))}
      </Box>
    </Box>
  )
}

const DOT = { used: L.used, background: L.count, idle: L.idle } as const

const Plugins = ({ E, w, d }: { E: E; w: number; d: HistoryDash }) => {
  const { Box, Text } = E
  const p = d.plugins
  const per = w >= 100 ? 3 : w >= 66 ? 2 : 1
  const cw = Math.floor(w / per)
  const counts = { used: 0, background: 0, idle: 0 }
  p.plugins.forEach(x => counts[x.status]++)
  return (
    <Box flexDirection="column" width={w}>
      <Line E={E}>
        <Text color={L.used}>● used </Text>
        <Text color={L.count}>● background (hooks, status line, LSP: not counted per call) </Text>
        <Text color={L.idle}>● no recorded use</Text>
      </Line>
      <Label E={E} text={`plugins · ${counts.used} used · ${counts.background} background · ${counts.idle} idle`} />
      <Box flexDirection="row" flexWrap="wrap" width={w}>
        {p.plugins.map(x => (
          <Box width={cw}>
            <Text wrap="truncate">
              <Text color={DOT[x.status]}>● </Text>
              <Text>{cell(x.name, cw - 12)}</Text>
              <Text color={L.muted}>{cell(x.status === 'background' ? 'bg' : num(x.uses), 8, 'right')}</Text>
            </Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={1} flexDirection="column" width={w}>
        <Label E={E} text="MCP servers · calls" />
        {p.mcp.map(s => (
          <Box flexDirection="column" width={w}>
            <Line E={E}>
              <Text color={s.calls ? L.used : L.idle}>● </Text>
              <Text>{cell(s.server.replace(/^claude_ai_/, '').replace(/^plugin_/, ''), w - 22)}</Text>
              <Text color={L.muted}>{cell(s.kind, 10, 'right')}</Text>
              <Text>{cell(num(s.calls), 8, 'right')}</Text>
            </Line>
            {s.tools.slice(0, 5).map(t => (
              <Text color={L.muted} wrap="truncate">{`    ${cell(t.name, w - 14)}${cell(num(t.n), 8, 'right')}`}</Text>
            ))}
          </Box>
        ))}
        <Text color={L.muted}>claude.ai connectors appear once they have been called.</Text>
      </Box>
    </Box>
  )
}

const shade = (m: number) => L.heat[!m ? 0 : m < 50 ? 1 : m < 250 ? 2 : m < 1000 ? 3 : 4]!

const Timeline = ({ E, w, d }: { E: E; w: number; d: HistoryDash }) => {
  const { Box, Text } = E
  const t = d.timeline
  const stats = [
    ['Active days', `${t.active}`],
    ['Streak', `${t.streak}d (best ${t.longestStreak}d)`],
    ['Avg gap', t.avgGap === null ? '—' : `${t.avgGap.toFixed(1)} days`],
    ['Longest', t.longest ? `${num(t.longest.messages)} msgs · ${t.longest.at.slice(5)}` : '—'],
  ] as const
  const weeks = Array.from({ length: 16 }, (_, k) => t.calendar.slice(k * 7, k * 7 + 7))
  const hMax = Math.max(1, ...t.hours)
  return (
    <Box flexDirection="column" width={w}>
      <Box flexDirection="row" flexWrap="wrap" width={w}>
        {stats.map(([k, v]) => (
          <Box flexDirection="column" width={Math.floor(w / (w >= 100 ? 4 : 2))} marginBottom={1}>
            <Label E={E} text={k} />
            <Text bold>{v}</Text>
          </Box>
        ))}
      </Box>
      <Label E={E} text={`activity · 16 weeks · first seen ${t.firstSeen ?? '—'}`} />
      {['Mon', '', 'Wed', '', 'Fri', '', 'Sun'].map((label, dow) => (
        <Line E={E}>
          <Text color={L.muted}>{cell(label, 4)}</Text>
          {weeks.map(wk => {
            const c = wk[dow]
            const future = !c || c.day > d.today
            return <Text color={future ? L.track : shade(c.m)}>{future ? '  ' : c.day === d.today ? '◆ ' : '■ '}</Text>
          })}
        </Line>
      ))}
      <Box marginTop={1} flexDirection="column" width={w}>
        <Label E={E} text="sessions started by hour" />
        <Text color={L.count}>
          {t.hours.map(h => (h ? '▁▂▃▄▅▆▇█'[Math.min(7, Math.floor((Math.sqrt(h) / Math.sqrt(hMax)) * 7.99))] : ' ')).join('')}
        </Text>
        <Text color={L.muted}>{'00    06    12    18   23'}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column" width={w}>
        <Label E={E} text="Claude Code versions" />
        {t.versions.map(v => (
          <Line E={E}>
            <Text color={v.current ? L.used : v.stale ? L.warn : L.ink}>{cell(v.v, 10)}</Text>
            <Text color={L.muted}>{cell(`${v.first.slice(5)} → ${v.current ? 'now' : v.last.slice(5)}`, 18)}</Text>
            <Text color={v.current ? L.used : L.warn}>{v.current ? 'current' : v.stale ? 'old build seen after update' : ''}</Text>
          </Line>
        ))}
        <Label E={E} text="biggest days" />
        {t.biggest.map(b => (
          <Line E={E}>
            <Text>{cell(b.day, 12)}</Text>
            <Text color={L.muted}>{`${num(b.m)} msgs`}</Text>
          </Line>
        ))}
      </Box>
    </Box>
  )
}

export const History = (p: HistoryProps & { home: string }) => {
  const { E, w, d, tab, status, insight } = p
  const { Box, Text } = E
  if (w < 60) return <Text color={L.muted}>Usage needs a wider terminal.</Text>
  const body = !d ? (
    <Text color={L.muted}>{status.startsWith('index failed') ? `${status}. Run /dash all again.` : 'Building the index…'}</Text>
  ) : tab === 'overview' ? (
    <Overview E={E} w={w} d={d} />
  ) : tab === 'models' ? (
    <Models E={E} w={w} d={d} />
  ) : tab === 'projects' ? (
    <Projects E={E} w={w} d={d} act={p.act} home={p.home} />
  ) : tab === 'tools' ? (
    <Tools E={E} w={w} d={d} />
  ) : tab === 'plugins' ? (
    <Plugins E={E} w={w} d={d} />
  ) : (
    <Timeline E={E} w={w} d={d} />
  )
  return (
    <Box flexDirection="column" width={w}>
      <Header {...p} />
      {body}
      {insight ? (
        <Box marginTop={1}>
          <Text color={L.money} wrap="wrap">{`▲ ${insight}`}</Text>
        </Box>
      ) : null}
      {d && status.startsWith('index failed') ? (
        <Box marginTop={1}>
          <Text color={L.warn} wrap="wrap">{status}</Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text color={L.muted} wrap="truncate">{`1-6 tabs · r range (${d?.range ?? 'all'}) · ${d?.project ? 'x clear filter · ' : ''}esc close · ${status || 'not indexed yet'}${d ? ` · ${d.pruned} pruned kept` : ''}`}</Text>
      </Box>
    </Box>
  )
}
