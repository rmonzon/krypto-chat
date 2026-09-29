const DAY_MS = 24 * 60 * 60 * 1000

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function hhmm(d: Date) {
  return [d.getHours(), d.getMinutes()].map((n) => String(n).padStart(2, '0')).join(':')
}

/** Compact timestamp for the conversation list: now, 23:51, yesterday, Mon, Sep 3. */
export function formatListTime(iso: string, now = new Date()): string {
  const d = new Date(iso)
  if (now.getTime() - d.getTime() < 60_000) return 'now'
  const days = Math.round((startOfDay(now) - startOfDay(d)) / DAY_MS)
  if (days <= 0) return hhmm(d)
  if (days === 1) return 'yesterday'
  if (days < 7) return d.toLocaleDateString('en-US', { weekday: 'short' })
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** 24h wall clock, e.g. 09:05:42. */
export function formatClock(d: Date): string {
  return hhmm(d) + ':' + String(d.getSeconds()).padStart(2, '0')
}

/** 24h hour:minute, e.g. 23:51. */
export function formatTime(iso: string): string {
  return hhmm(new Date(iso))
}

/** Local calendar day, for grouping messages: 2026-09-29. */
export function dayKey(iso: string): string {
  const d = new Date(iso)
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()]
    .map((n) => String(n).padStart(2, '0'))
    .join('-')
}

/** Day divider label: Today, Yesterday, Mon, Sep 28, or Sep 28, 2025 in other years. */
export function formatDayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const days = Math.round((startOfDay(now) - startOfDay(d)) / DAY_MS)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (d.getFullYear() !== now.getFullYear()) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
