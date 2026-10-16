// Colour carries meaning only. Identity colours name a gauge; the heat scale
// says how close it is to its limit, the same way on every gauge. Tuned for
// a black terminal: secondary text is a light grey, not the theme's dim one.
export const C = {
  fg: '#E6E9F5',
  muted: '#A4ACC4',
  track: '#5A6284',
  ident: '#BEACFF',
  ink: '#18162A',
  ok: '#7DD8A0',
  watch: '#F5C469',
  hot: '#F57D78',
  money: '#F0B85C',
  live: '#78C4FA',
  skills: '#EC96C8',
  context: '#F7A878',
  card: '#1D2030',
  pace: '#F0F2FC',
} as const

export const levelColor = (pct: number): string =>
  pct >= 90 ? C.hot : pct >= 70 ? C.watch : C.ok

const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
const hex = (c: number[]) => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()
const mix = (a: string, b: string, f: number) => {
  const [x, y] = [rgb(a), rgb(b)]
  return hex(x.map((v, i) => v + (y[i]! - v) * f))
}

// The colour of position x (0..1) on the shared scale: mint below 70%,
// blending to amber by 90%, then to coral at 100%.
export const heat = (x: number): string =>
  x < 0.7 ? C.ok : x < 0.9 ? mix(C.ok, C.watch, (x - 0.7) / 0.2) : mix(C.watch, C.hot, Math.min(1, (x - 0.9) / 0.1))

// One colour per model family, used for its name, effort dots and bar.
export const MODEL_COLOR: Record<string, string> = {
  opus: '#B9A4FF',
  sonnet: '#5EDCF0',
  haiku: '#7DE3A0',
  fable: '#FF9EC7',
  mythos: '#FFB86B',
}
export const modelColor = (id: string): string => {
  const family = Object.keys(MODEL_COLOR).find(f => id.toLowerCase().includes(f))
  return family ? MODEL_COLOR[family]! : C.fg
}

export const GROUP_COLOR = {
  messages: C.ident,
  tools: C.live,
  system: C.ok,
  memory: C.watch,
  skills: C.skills,
  other: C.muted,
} as const

export const hexToInt = (h: string): number => parseInt(h.slice(1), 16)

// /dash all ("Ledger"): one ground, colour only where it means something.
// Amber is money and focus, blue counts, teal skills and "used".
export const LEDGER = {
  ink: '#E4E7EC',
  muted: '#9AA3B2',
  line: '#2A2F3A',
  track: '#1F242D',
  money: '#F5A524',
  count: '#5EA6FF',
  used: '#3DD6B0',
  agent: '#B392F0',
  warn: '#F47C8A',
  idle: '#4A5160',
  heat: ['#1F242D', '#1E4A7A', '#2F78C4', '#5EA6FF', '#F5A524'],
} as const
