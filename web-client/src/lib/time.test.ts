import { describe, expect, it } from 'vitest'
import { dayKey, formatClock, formatDayLabel, formatListTime, formatTime } from './time'

// Local times, so the assertions don't depend on the test machine's timezone.
const now = new Date(2026, 8, 29, 14, 30, 0) // Tue Sep 29 2026, 14:30

describe('formatListTime', () => {
  it('says "now" within the last minute', () => {
    expect(formatListTime(new Date(2026, 8, 29, 14, 29, 30).toISOString(), now)).toBe('now')
  })

  it('shows the time for earlier today', () => {
    expect(formatListTime(new Date(2026, 8, 29, 9, 5).toISOString(), now)).toBe('09:05')
  })

  it('says "yesterday" for the previous calendar day', () => {
    expect(formatListTime(new Date(2026, 8, 28, 23, 59).toISOString(), now)).toBe('yesterday')
  })

  it('shows the weekday within the last week', () => {
    expect(formatListTime(new Date(2026, 8, 24, 12, 0).toISOString(), now)).toBe('Thu')
  })

  it('shows month and day for older dates', () => {
    expect(formatListTime(new Date(2026, 8, 3, 12, 0).toISOString(), now)).toBe('Sep 3')
  })
})

describe('formatClock', () => {
  it('zero-pads hours, minutes and seconds', () => {
    expect(formatClock(new Date(2026, 0, 1, 9, 5, 7))).toBe('09:05:07')
  })
})

describe('formatTime', () => {
  it('shows 24h hours and minutes', () => {
    expect(formatTime(new Date(2026, 8, 29, 23, 5).toISOString())).toBe('23:05')
  })
})

describe('dayKey', () => {
  it('groups by local calendar day', () => {
    expect(dayKey(new Date(2026, 8, 29, 0, 1).toISOString())).toBe('2026-09-29')
    expect(dayKey(new Date(2026, 8, 29, 23, 59).toISOString())).toBe('2026-09-29')
  })
})

describe('formatDayLabel', () => {
  it('names today and yesterday', () => {
    expect(formatDayLabel(new Date(2026, 8, 29, 1, 0).toISOString(), now)).toBe('Today')
    expect(formatDayLabel(new Date(2026, 8, 28, 23, 0).toISOString(), now)).toBe('Yesterday')
  })

  it('shows weekday and date this year, and the year otherwise', () => {
    expect(formatDayLabel(new Date(2026, 8, 3, 12, 0).toISOString(), now)).toBe('Thu, Sep 3')
    expect(formatDayLabel(new Date(2025, 11, 31, 12, 0).toISOString(), now)).toBe('Dec 31, 2025')
  })
})
