export type Limit = { kind: string; pct: number; resetsAt?: number }

export type Usage = {
  startedAt: number
  ctxTokens?: number
  ctxWindow: number
  ctxPct?: number
  limits: Limit[]
  costUsd?: number
}

export type Sample = { t: number; pct: number }
export type PaceWindow = { samples: Sample[]; resetsAt?: number }

export type Turn = { durationMs: number; tools: number; costDelta?: number }
export type Totals = { turns: number; inTok: number; outTok: number }

export type AgentStatus = 'running' | 'done' | 'failed' | 'lost'

export type Agent = {
  id: string
  type: string
  description: string
  model?: string
  startedAt: number
  lastEventAt: number
  endedAt?: number
  tools: number
  lastTools: string[]
  status: AgentStatus
  outTok?: number
  runId?: string
  toolUseId?: string
}

export type Agents = { list: Agent[]; runNames: Record<string, string> }

export type GroupKey = 'messages' | 'tools' | 'system' | 'memory' | 'skills' | 'other'
export type Group = { key: GroupKey; tokens: number }

export type Loadout = {
  skills: number
  userSkills: number
  plugins: number
  mcp: number
  agents: number
}

export type MonthCost = { month: string; usd: number; byModel: Record<string, number> }

export type Peer = {
  sessionId: string
  label: string
  cwd: string
  model: string
  isBusy: boolean
  agentsRunning: number
  costUsd?: number
  updatedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'session-dash': {
      active: boolean
      usage: Usage | null
      model: string
      modelId: string
      effort: string
      pace: Record<string, PaceWindow>
      history: Sample[]
      turn: Turn | null
      totals: Totals
      busy: boolean
      agents: Agents
      groups: Group[]
      loadout: Loadout | null
      peers: Peer[]
      folds: Record<string, boolean>
      tick: number
      alerted: string[]
      autoOpened: boolean
      month: MonthCost | null
      efforts: Record<string, string>
      allTab: 'overview' | 'models' | 'projects' | 'tools' | 'plugins' | 'timeline'
      allRange: '7d' | '30d' | 'all'
      allProject: string | null
      allStatus: string
      allRev: number
    }
  }
}
