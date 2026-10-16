import type { HistoryDash, TabId } from './history'

// At most one line per tab, and only when it is true by a clear margin:
// a dashboard that always has something to say teaches people to skip it.

const pc = (x: number) => `${Math.round(x * 100)}%`

export const insights = (d: HistoryDash): Partial<Record<TabId, string>> => {
  const out: Partial<Record<TabId, string>> = {}
  const usd = d.overview.usd
  const topModel = d.models.rows[0]
  if (topModel && usd > 0 && topModel.usd / usd >= 0.6) out.overview = `${topModel.model} is ${pc(topModel.usd / usd)} of est. spend`

  const s = d.models.split
  const sTotal = s ? s.in + s.out + s.cr + s.cw : 0
  if (topModel && s && sTotal > 0 && s.cr / sTotal >= 0.5) {
    out.models = `Re-reading cached context is ${pc(s.cr / sTotal)} of ${topModel.model}’s cost. Shorter sessions or /compact cut it most.`
  }

  const n = (name: string) => d.tools.tools.find(t => t.name === name)?.n ?? 0
  const toolTotal = d.tools.tools.reduce((a, t) => a + t.n, 0)
  if (n('Edit') === 0 && n('Bash') > 100) {
    out.tools = `0 Edit calls and ${n('Bash')} Bash calls: file changes are going through Bash.`
  } else if (toolTotal > 0 && d.tools.tools[0]!.n / toolTotal >= 0.6) {
    out.tools = `${d.tools.tools[0]!.name} is ${pc(d.tools.tools[0]!.n / toolTotal)} of tool calls`
  }

  const idle = d.plugins.plugins.filter(p => p.status === 'idle').length
  if (idle >= 5) out.plugins = `${idle} of ${d.plugins.plugins.length} plugins have no recorded use.`

  const topProject = d.projects[0]
  if (topProject && usd > 0 && topProject.usd / usd >= 0.6) out.projects = `${topProject.project} is ${pc(topProject.usd / usd)} of est. spend`

  const hours = d.timeline.hours
  const hTotal = hours.reduce((a, h) => a + h, 0)
  const peak = hours.indexOf(Math.max(...hours))
  if (hTotal > 0 && hours[peak]! / hTotal >= 0.5) {
    const hh = (h: number) => `${String(h % 24).padStart(2, '0')}:00`
    out.timeline = `${pc(hours[peak]! / hTotal)} of sessions start between ${hh(peak)} and ${hh(peak + 1)}`
  }
  return out
}
