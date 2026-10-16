const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

// 24s · 1m12s · 34m · 1h 12m · 4d 2h
export const dur = (ms: number | undefined): string => {
  if (ms === undefined || !(ms > 0)) return '—'
  if (ms < MIN) return `${Math.floor(ms / 1000)}s`
  if (ms < 10 * MIN) {
    const s = Math.floor((ms % MIN) / 1000)
    return s ? `${Math.floor(ms / MIN)}m${String(s).padStart(2, '0')}s` : `${Math.floor(ms / MIN)}m`
  }
  if (ms < HOUR) return `${Math.floor(ms / MIN)}m`
  if (ms < DAY) {
    const m = Math.floor((ms % HOUR) / MIN)
    return `${Math.floor(ms / HOUR)}h ${m}m`
  }
  return `${Math.floor(ms / DAY)}d ${Math.floor((ms % DAY) / HOUR)}h`
}

export const tok = (n: number | undefined): string => {
  if (n === undefined || !Number.isFinite(n)) return '—'
  if (n < 1000) return String(Math.round(n))
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

// $1,489 — whole dollars with thousands separators
export const usdWhole = (x: number): string =>
  '$' + String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

export const usd = (x: number | undefined): string => {
  if (x === undefined || !Number.isFinite(x)) return '—'
  return x >= 100 ? `$${Math.round(x)}` : `$${x.toFixed(2)}`
}

export const pct = (x: number | undefined): string =>
  x === undefined ? '—' : `${Math.round(x)}%`

export const truncMid = (s: string, n: number): string => {
  if (s.length <= n) return s
  if (n <= 1) return '…'.slice(0, n)
  const head = Math.ceil((n - 1) / 2)
  const tail = n - 1 - head
  return s.slice(0, head) + '…' + (tail ? s.slice(-tail) : '')
}

export const truncEnd = (s: string, n: number): string =>
  s.length <= n ? s : n <= 1 ? '…' : s.slice(0, n - 1) + '…'

// claude-opus-5-5 → Opus 5.5
export const prettyModel = (id: string | undefined): string => {
  if (!id) return 'Claude'
  const m = /(opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?/i.exec(id)
  if (!m || !m[1] || !m[2]) return id
  const name = m[1][0]!.toUpperCase() + m[1].slice(1).toLowerCase()
  return m[3] ? `${name} ${m[2]}.${m[3]}` : `${name} ${m[2]}`
}

const IST_OFFSET = 330 * MIN
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAY_MS = 24 * HOUR

// A reset time in IST, 12-hour: '1:50 AM' today, 'tomorrow 1:50 AM',
// 'Wed 14 Oct, 2:30 PM' beyond. IST has no daylight saving, so a fixed
// offset is exact.
export const stamp = (ms: number, now: number): string => {
  const ist = new Date(ms + IST_OFFSET)
  const day = (t: number) => new Date(t + IST_OFFSET).toISOString().slice(0, 10)
  const h = ist.getUTCHours()
  const time = `${h % 12 || 12}:${String(ist.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
  if (day(ms) === day(now)) return time
  if (day(ms) === day(now + DAY_MS)) return `tomorrow ${time}`
  return `${DAYS[ist.getUTCDay()]} ${ist.getUTCDate()} ${MONTHS[ist.getUTCMonth()]}, ${time}`
}

const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']

// A bar `w` cells wide filled to `frac`, in eighth-cell steps, padded so
// columns after it line up.
export const hbar = (frac: number, w: number): string => {
  const f = Math.min(1, Math.max(0, Number.isFinite(frac) ? frac : 0))
  const eighths = Math.round(f * w * 8)
  const full = Math.floor(eighths / 8)
  const s = '█'.repeat(full) + (full < w ? EIGHTHS[eighths % 8]! : '')
  return s.padEnd(w)
}

export const num = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
