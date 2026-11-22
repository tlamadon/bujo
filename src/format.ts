// How dates are shown. One place, so every view agrees, and in the browser's
// locale rather than a hard-coded one.

import { dateKind, weekStart, addDays } from '@bujo/core'
import { parseDate } from './dateUtils'

const formatters = new Map<string, Intl.DateTimeFormat>()

function fmt(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(options)
  let f = formatters.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(undefined, options)
    formatters.set(key, f)
  }
  return f
}

/** "Sunday, November 22" — with the year when it is not `today`'s. */
export function formatDayLong(day: string, today: string): string {
  const sameYear = day.slice(0, 4) === today.slice(0, 4)
  return fmt({
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(parseDate(day))
}

/** "Nov 22" */
export function formatDayShort(day: string): string {
  return fmt({ month: 'short', day: 'numeric' }).format(parseDate(day))
}

/** "Sun, Nov 22, 2026" */
export function formatDayFull(day: string): string {
  return fmt({ weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(parseDate(day))
}

/** "Sun" */
export function formatWeekday(day: string): string {
  return fmt({ weekday: 'short' }).format(parseDate(day))
}

/** "November 2026" */
export function formatMonth(month: string): string {
  return fmt({ month: 'long', year: 'numeric' }).format(parseDate(`${month}-01`))
}

/** "Nov 16 – 22, 2026" */
export function formatWeekRange(week: string): string {
  const start = weekStart(week)
  const f = fmt({ month: 'short', day: 'numeric', year: 'numeric' })
  return f.formatRange(parseDate(start), parseDate(addDays(start, 6)))
}

/** Any entry date value: a day, a month, a week, or unscheduled. */
export function formatDateValue(date: string): string {
  switch (dateKind(date)) {
    case 'day':
      return formatDayFull(date)
    case 'month':
      return formatMonth(date)
    case 'week':
      return `Week of ${formatWeekRange(date)}`
    default:
      return 'Unscheduled'
  }
}

/** A short form for list columns: "Nov 22", "Nov 2026", "W47", "—". */
export function formatDateCompact(date: string): string {
  switch (dateKind(date)) {
    case 'day':
      return formatDayShort(date)
    case 'month':
      return fmt({ month: 'short', year: 'numeric' }).format(parseDate(`${date}-01`))
    case 'week':
      return date.slice(5)
    default:
      return '—'
  }
}

/** "Nov 22, 2026, 11:16 AM" */
export function formatTimestamp(ms: number): string {
  return fmt({ dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms))
}
