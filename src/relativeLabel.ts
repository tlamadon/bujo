import { parseDate } from './dateUtils'

/** Relative label for a day vs today */
export function relativeDayLabel(isoDate: string): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = parseDate(isoDate)
  const diffMs = target.getTime() - today.getTime()
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return 'today'
  if (diffDays === 1) return 'tomorrow'
  if (diffDays === -1) return 'yesterday'
  if (diffDays > 0) return `${diffDays} days ahead`
  return `${Math.abs(diffDays)} days ago`
}

/** Relative label for a week (given its Monday) vs current week */
export function relativeWeekLabel(monday: Date): string {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const currentMonday = getMonday(now)
  const diffMs = monday.getTime() - currentMonday.getTime()
  const diffWeeks = Math.round(diffMs / (7 * 24 * 60 * 60 * 1000))

  if (diffWeeks === 0) return 'this week'
  if (diffWeeks === 1) return 'next week'
  if (diffWeeks === -1) return 'last week'
  if (diffWeeks > 0) return `${diffWeeks} weeks ahead`
  return `${Math.abs(diffWeeks)} weeks ago`
}

/** Relative label for a month vs current month */
export function relativeMonthLabel(year: number, month: number): string {
  const now = new Date()
  const diffMonths = (year - now.getFullYear()) * 12 + (month - now.getMonth())

  if (diffMonths === 0) return 'this month'
  if (diffMonths === 1) return 'next month'
  if (diffMonths === -1) return 'last month'
  if (diffMonths > 0) return `${diffMonths} months ahead`
  return `${Math.abs(diffMonths)} months ago`
}

function getMonday(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff)
  d.setHours(0, 0, 0, 0)
  return d
}
