import { daysBetween, isoWeekKey, monthKey, weekStart } from '@bujo/core'

/** Relative label for a day vs today */
export function relativeDayLabel(day: string, today: string): string {
  const diff = daysBetween(today, day)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  if (diff > 0) return `${diff} days ahead`
  return `${-diff} days ago`
}

/** Relative label for an ISO week vs the current one */
export function relativeWeekLabel(week: string, today: string): string {
  const diff = Math.round(daysBetween(weekStart(isoWeekKey(today)), weekStart(week)) / 7)
  if (diff === 0) return 'This week'
  if (diff === 1) return 'Next week'
  if (diff === -1) return 'Last week'
  if (diff > 0) return `${diff} weeks ahead`
  return `${-diff} weeks ago`
}

/** Relative label for a month vs the current one */
export function relativeMonthLabel(month: string, today: string): string {
  const index = (key: string) => Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7))
  const diff = index(month) - index(monthKey(today))
  if (diff === 0) return 'This month'
  if (diff === 1) return 'Next month'
  if (diff === -1) return 'Last month'
  if (diff > 0) return `${diff} months ahead`
  return `${-diff} months ago`
}
