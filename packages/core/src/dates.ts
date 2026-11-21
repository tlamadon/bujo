// Date values used by entries, and the arithmetic on them.
//
// An entry's `date` is one of:
//   day          YYYY-MM-DD   the daily log
//   month        YYYY-MM      the future log ("some time in December"), or a monthly goal
//   week         YYYY-Www     an ISO week (Monday start); weekly goals only
//   unscheduled  ~unscheduled
//
// All of them are plain strings, used as the prefix of the entry's `_id`, so
// one prefix query returns everything dated to a given day, week or month.
// Arithmetic is done on calendar dates in UTC, so it is DST-proof; "today" is
// the only thing that depends on a timezone.

import { InvalidError } from './errors'
import { UNSCHEDULED } from './types'

export type DateKind = 'day' | 'week' | 'month' | 'unscheduled'

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const MONTH_RE = /^(\d{4})-(\d{2})$/
const WEEK_RE = /^(\d{4})-W(\d{2})$/
const MS_PER_DAY = 86_400_000

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0')
}

function toUtc(day: string): number {
  const m = DAY_RE.exec(day)
  if (!m) throw new InvalidError(`"${day}" is not a YYYY-MM-DD date`)
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

function fromUtc(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

// ─── Kinds ─────────────────────────────────────────────────────────

/** A real calendar day, YYYY-MM-DD (2026-02-30 is not one). */
export function isDayDate(date: string): boolean {
  return DAY_RE.test(date) && fromUtc(toUtc(date)) === date
}

/** A month key, YYYY-MM. */
export function isMonthKey(date: string): boolean {
  const m = MONTH_RE.exec(date)
  return !!m && Number(m[2]) >= 1 && Number(m[2]) <= 12
}

/** An ISO week key, YYYY-Www, for a week that exists in that year. */
export function isWeekKey(date: string): boolean {
  const m = WEEK_RE.exec(date)
  if (!m) return false
  const week = Number(m[2])
  return week >= 1 && week <= weeksInYear(Number(m[1]))
}

/** Classify a date value, or null when it is not a valid one. */
export function dateKind(date: string): DateKind | null {
  if (date === UNSCHEDULED) return 'unscheduled'
  if (isDayDate(date)) return 'day'
  if (isMonthKey(date)) return 'month'
  if (isWeekKey(date)) return 'week'
  return null
}

// ─── Days ──────────────────────────────────────────────────────────

export function addDays(day: string, n: number): string {
  return fromUtc(toUtc(day) + n * MS_PER_DAY)
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function weekdayOf(day: string): number {
  return ((new Date(toUtc(day)).getUTCDay() + 6) % 7) + 1
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / MS_PER_DAY)
}

/** Today's date in `timeZone` (an IANA name; default: the system timezone). */
export function todayIn(timeZone?: string, now: number = Date.now()): string {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || undefined,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(now))
  } catch {
    throw new InvalidError(`Unknown timezone "${timeZone}"`)
  }
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

// ─── ISO weeks ─────────────────────────────────────────────────────

/** The ISO week a day falls in, e.g. 2026-11-21 → 2026-W47. */
export function isoWeekKey(day: string): string {
  // The ISO year of a week is the calendar year of its Thursday.
  const thursday = toUtc(day) + (4 - weekdayOf(day)) * MS_PER_DAY
  const year = new Date(thursday).getUTCFullYear()
  const week = Math.floor((thursday - Date.UTC(year, 0, 1)) / (7 * MS_PER_DAY)) + 1
  return `${pad(year, 4)}-W${pad(week)}`
}

/** Number of ISO weeks (52 or 53) in an ISO year. */
export function weeksInYear(year: number): number {
  // December 28th is always in the last ISO week of its year.
  return Number(isoWeekKey(`${pad(year, 4)}-12-28`).slice(-2))
}

/** The Monday an ISO week starts on. */
export function weekStart(weekKey: string): string {
  const m = WEEK_RE.exec(weekKey)
  if (!m) throw new InvalidError(`"${weekKey}" is not a YYYY-Www week`)
  // January 4th is always in week 1.
  const jan4 = `${m[1]}-01-04`
  const firstMonday = addDays(jan4, 1 - weekdayOf(jan4))
  return addDays(firstMonday, (Number(m[2]) - 1) * 7)
}

/** The seven days of an ISO week, Monday first. */
export function weekDays(weekKey: string): string[] {
  const monday = weekStart(weekKey)
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}

export function addWeeks(weekKey: string, n: number): string {
  return isoWeekKey(addDays(weekStart(weekKey), n * 7))
}

// ─── Months ────────────────────────────────────────────────────────

/** The month a day falls in, e.g. 2026-11-21 → 2026-11. */
export function monthKey(day: string): string {
  return day.slice(0, 7)
}

export function addMonths(month: string, n: number): string {
  const m = MONTH_RE.exec(month)
  if (!m) throw new InvalidError(`"${month}" is not a YYYY-MM month`)
  const index = Number(m[1]) * 12 + (Number(m[2]) - 1) + n
  return `${pad(Math.floor(index / 12), 4)}-${pad((index % 12) + 1)}`
}

/** Every day of a month, in order. */
export function monthDays(month: string): string[] {
  if (!isMonthKey(month)) throw new InvalidError(`"${month}" is not a YYYY-MM month`)
  const days: string[] = []
  for (let day = `${month}-01`; monthKey(day) === month; day = addDays(day, 1)) days.push(day)
  return days
}

// ─── Periods ───────────────────────────────────────────────────────

/** First and last day of a week or month key. */
export function periodRange(period: string): { start: string; end: string } {
  if (isWeekKey(period)) {
    const start = weekStart(period)
    return { start, end: addDays(start, 6) }
  }
  if (isMonthKey(period)) {
    const days = monthDays(period)
    return { start: days[0], end: days[days.length - 1] }
  }
  throw new InvalidError(`"${period}" is not a week (YYYY-Www) or month (YYYY-MM)`)
}

// ─── Parsing what people type ──────────────────────────────────────

const WEEKDAYS: Record<string, number> = {
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
  sun: 7, sunday: 7,
}

const DATE_HELP =
  'Use YYYY-MM-DD, YYYY-MM, YYYY-Www, today, tomorrow, yesterday, mon..sun, +3d, +2w, ' +
  'next-week, this-month, next-month or unscheduled'

/**
 * Turn user input into a date value, relative to `today`.
 *
 *   today, tomorrow, yesterday      that day
 *   mon … sun                       the next such weekday, strictly after today
 *   +3d, -1d, +2w, +3               days (default) or weeks from today
 *   next-week                       Monday of next week
 *   this-month, next-month          a month key (future log)
 *   YYYY-MM-DD, YYYY-MM, YYYY-Www   as given, validated
 *   unscheduled, someday, none      ~unscheduled
 */
export function parseDateInput(input: string, today: string): string {
  const raw = input.trim()
  const s = raw.toLowerCase().replace(/[\s_]+/g, '-')
  if (!s) throw new InvalidError(`Empty date. ${DATE_HELP}`)

  if (s === 'today' || s === 'tod' || s === 'now') return today
  if (s === 'tomorrow' || s === 'tom') return addDays(today, 1)
  if (s === 'yesterday') return addDays(today, -1)
  if (s === 'unscheduled' || s === 'someday' || s === 'none' || s === UNSCHEDULED) return UNSCHEDULED
  if (s === 'next-week') return addDays(weekStart(isoWeekKey(today)), 7)
  if (s === 'this-month') return monthKey(today)
  if (s === 'next-month') return addMonths(monthKey(today), 1)

  const relative = /^([+-])(\d+)([dw]?)$/.exec(s)
  if (relative) {
    const amount = Number(relative[2]) * (relative[3] === 'w' ? 7 : 1)
    return addDays(today, relative[1] === '-' ? -amount : amount)
  }

  const weekday = WEEKDAYS[s]
  if (weekday) {
    const ahead = (weekday - weekdayOf(today) + 7) % 7
    return addDays(today, ahead === 0 ? 7 : ahead)
  }

  const upper = raw.toUpperCase()
  if (DAY_RE.test(raw)) {
    if (!isDayDate(raw)) throw new InvalidError(`"${raw}" is not a real calendar date`)
    return raw
  }
  if (MONTH_RE.test(raw)) {
    if (!isMonthKey(raw)) throw new InvalidError(`"${raw}" is not a valid month`)
    return raw
  }
  if (WEEK_RE.test(upper)) {
    if (!isWeekKey(upper)) throw new InvalidError(`"${raw}" is not a valid ISO week`)
    return upper
  }
  throw new InvalidError(`Unrecognized date "${raw}". ${DATE_HELP}`)
}

function parseOffset(s: string): number | null {
  if (s === 'this' || s === 'current' || s === 'now') return 0
  if (s === 'next') return 1
  if (s === 'last' || s === 'prev' || s === 'previous') return -1
  const m = /^([+-])(\d+)$/.exec(s)
  return m ? Number(m[2]) * (m[1] === '-' ? -1 : 1) : null
}

/**
 * Turn user input into an ISO week key: `YYYY-Www`, an offset from the
 * current week (`this`, `next`, `last`, `+1`, `-2`), or any day in the week.
 */
export function parseWeekInput(input: string | undefined, today: string): string {
  const raw = (input ?? 'this').trim()
  const s = raw.toLowerCase().replace(/-week$/, '')
  const offset = parseOffset(s)
  if (offset !== null) return addWeeks(isoWeekKey(today), offset)
  const upper = raw.toUpperCase()
  if (WEEK_RE.test(upper)) {
    if (!isWeekKey(upper)) throw new InvalidError(`"${raw}" is not a valid ISO week`)
    return upper
  }
  if (isDayDate(raw)) return isoWeekKey(raw)
  throw new InvalidError(`Unrecognized week "${raw}". Use YYYY-Www, this, next, last, +1 or -1`)
}

/**
 * Turn user input into a month key: `YYYY-MM`, an offset from the current
 * month (`this`, `next`, `last`, `+1`, `-2`), or any day in the month.
 */
export function parseMonthInput(input: string | undefined, today: string): string {
  const raw = (input ?? 'this').trim()
  const s = raw.toLowerCase().replace(/-month$/, '')
  const offset = parseOffset(s)
  if (offset !== null) return addMonths(monthKey(today), offset)
  if (MONTH_RE.test(raw)) {
    if (!isMonthKey(raw)) throw new InvalidError(`"${raw}" is not a valid month`)
    return raw
  }
  if (isDayDate(raw)) return monthKey(raw)
  throw new InvalidError(`Unrecognized month "${raw}". Use YYYY-MM, this, next, last, +1 or -1`)
}
