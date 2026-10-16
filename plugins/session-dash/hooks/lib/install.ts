// The status line and the month-cost script ship inside the plugin, but an
// installed plugin's folder carries its version, so the status line setting
// cannot point into it. They are copied to one stable folder instead, and the
// status line setting points there.

// prices.py first: cost.py and history.py import it, and a copy that stops
// partway must not leave the status line's cost.py without it.
export const BUNDLE = ['prices.py', 'statusline.sh', 'cost.py', 'history.py'] as const

export const binDir = (home: string) => `${home}/.claude/session-dash/bin`

export const STATUS_LINE_COMMAND = 'bash "$HOME/.claude/session-dash/bin/statusline.sh"'

// 'set': nothing configured, so ours goes in. 'ours': already ours.
// 'other': someone else's, left alone unless asked with /dash statusline.
export type StatusLinePlan = 'set' | 'ours' | 'other'

export const planStatusLine = (current: unknown): StatusLinePlan => {
  if (current === undefined || current === null) return 'set'
  const cmd = typeof current === 'object' ? (current as { command?: unknown }).command : undefined
  return typeof cmd === 'string' && cmd.includes('session-dash/bin/statusline.sh') ? 'ours' : 'other'
}

// settings.json's text with our status line in it, every other key kept.
export const withStatusLine = (text: string): string => {
  const s: unknown = text.trim() ? JSON.parse(text) : {}
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error('settings.json does not hold an object')
  return `${JSON.stringify({ ...s, statusLine: { type: 'command', command: STATUS_LINE_COMMAND } }, null, 2)}\n`
}
