// Read models: the data behind each journal view, as plain JSON.
//
// This is the stable machine-readable interface (the CLI's `--json` output
// is exactly these objects). Anything a front end shows — CLI, MCP server —
// should come from here, so they all agree.

import {
  dateKind,
  isDayDate,
  isMonthKey,
  isoWeekKey,
  monthDays,
  monthKey,
  periodRange,
  weekDays,
  weekdayOf,
  type DateKind,
} from './dates'
import { InvalidError } from './errors'
import { refOf } from './ids'
import { isClosed, isOpen, movesOf, type Bujo } from './store'
import { stripTags } from './tags'
import { UNSCHEDULED, type BujoEntry, type BujoStatus, type DisplayEntry } from './types'

// ─── Entries ───────────────────────────────────────────────────────

export interface EntryView {
  /** Short stable reference; survives reschedules */
  ref: string
  /** Full document id; its date prefix changes when the entry moves */
  id: string
  status: BujoStatus
  /** `YYYY-MM-DD`, `YYYY-MM`, `YYYY-Www` or `"unscheduled"` */
  date: string
  dateKind: DateKind
  /** Text as written, including #tags */
  body: string
  /** Text without the #tags */
  text: string
  tags: string[]
  priority: boolean
  /** Still to do: an open task or an open goal */
  open: boolean
  /** `HH:MM` for timed events, otherwise null */
  time: string | null
  /** Goals: `open`, `achieved` or `dropped`. Null for everything else */
  goalState: 'open' | 'achieved' | 'dropped' | null
  /** Dates the entry was on before, oldest first */
  dateHistory: string[]
  /** Number of times the entry was rescheduled (`dateHistory.length`) */
  moves: number
  /** ISO 8601 timestamp */
  createdAt: string
}

/** An entry seen from a day it used to be on. `date` is where it is now. */
export interface GhostView extends EntryView {
  /** The day the entry was moved away from */
  ghostDate: string
}

/** A date value as shown to the outside: `~unscheduled` becomes `unscheduled`. */
export function displayDate(date: string): string {
  return date === UNSCHEDULED ? 'unscheduled' : date
}

export function toEntryView(entry: BujoEntry): EntryView {
  return {
    ref: refOf(entry._id),
    id: entry._id,
    status: entry.status,
    date: displayDate(entry.date),
    dateKind: dateKind(entry.date) ?? 'unscheduled',
    body: entry.body,
    text: stripTags(entry.body),
    tags: entry.tags ?? [],
    priority: !!entry.priority,
    open: isOpen(entry),
    time: entry.status === 'event' && entry.time ? entry.time : null,
    goalState: entry.status === 'goal' ? (entry.goalState ?? 'open') : null,
    dateHistory: (entry.dateHistory ?? []).map(displayDate),
    moves: movesOf(entry),
    createdAt: new Date(entry.createdAt).toISOString(),
  }
}

function toGhostView(display: DisplayEntry): GhostView {
  return { ...toEntryView(display.entry), ghostDate: display.ghostDoc?.date ?? display.entry.date }
}

/** Reading order within a day: what needs doing first, what is settled last. */
function dayRank(entry: BujoEntry): number {
  switch (entry.status) {
    case 'goal':
      return entry.goalState ? 1 : 0
    case 'task':
      return entry.priority ? 2 : 3
    case 'event':
      return 4
    case 'note':
      return 5
    case 'migrated':
    case 'scheduled':
      return 6
    case 'completed':
      return 7
    case 'dropped':
      return 8
    default:
      return 9
  }
}

function compareInDay(a: BujoEntry, b: BujoEntry): number {
  const rank = dayRank(a) - dayRank(b)
  if (rank !== 0) return rank
  if (a.status === 'event' && b.status === 'event' && a.time !== b.time) {
    // Timed events in order, untimed ones after them
    if (!a.time) return 1
    if (!b.time) return -1
    return a.time < b.time ? -1 : 1
  }
  return a.createdAt - b.createdAt
}

/** Chronological: by date, then by reading order within the date. */
function compareByDate(a: BujoEntry, b: BujoEntry): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1
  return compareInDay(a, b)
}

function sortedViews(entries: BujoEntry[], compare = compareInDay): EntryView[] {
  return [...entries].sort(compare).map(toEntryView)
}

const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export function weekdayName(day: string): string {
  return WEEKDAY_NAMES[weekdayOf(day) - 1]
}

// ─── Daily log ─────────────────────────────────────────────────────

export interface DayView {
  date: string
  weekday: string
  /** Whether this is today */
  isToday: boolean
  /** Open tasks first (priority ones on top), then events, notes, done, dropped */
  entries: EntryView[]
  /** Entries that were on this day and moved away */
  ghosts: GhostView[]
}

export interface TodayView extends DayView {
  week: string
  /**
   * Open tasks left on earlier days (and in earlier months of the future
   * log). Only filled when `date` is today; `migrate` moves them here.
   */
  overdue: EntryView[]
}

function toDayView(date: string, today: string, displays: DisplayEntry[]): DayView {
  const here = displays.filter((d) => (d.isGhost ? d.ghostDoc?.date === date : d.entry.date === date))
  return {
    date,
    weekday: weekdayName(date),
    isToday: date === today,
    entries: sortedViews(here.filter((d) => !d.isGhost).map((d) => d.entry)),
    ghosts: here
      .filter((d) => d.isGhost)
      .sort((a, b) => a.entry.createdAt - b.entry.createdAt)
      .map(toGhostView),
  }
}

/** The daily log for `date`. */
export async function dayLog(bujo: Bujo, date: string, today: string): Promise<TodayView> {
  if (!isDayDate(date)) throw new InvalidError(`"${date}" is not a day (YYYY-MM-DD)`)
  const displays = await bujo.getEntriesForDate(date)
  const overdue = date === today ? await bujo.getOverdueTasks(today) : []
  return {
    ...toDayView(date, today, displays),
    week: isoWeekKey(date),
    overdue: overdue.map(toEntryView),
  }
}

// ─── Weekly log ────────────────────────────────────────────────────

export interface WeekView {
  /** ISO week key, `YYYY-Www` */
  week: string
  /** Monday */
  start: string
  /** Sunday */
  end: string
  /** Whether today falls in this week */
  current: boolean
  goals: EntryView[]
  /** Monday to Sunday */
  days: DayView[]
}

export async function weekLog(bujo: Bujo, week: string, today: string): Promise<WeekView> {
  const days = weekDays(week)
  const [goals, displays] = await Promise.all([
    bujo.getGoals(week),
    bujo.getEntriesForDateRange(days[0], days[6]),
  ])
  return {
    week,
    start: days[0],
    end: days[6],
    current: isoWeekKey(today) === week,
    goals: sortedViews(goals),
    days: days.map((day) => toDayView(day, today, displays)),
  }
}

// ─── Monthly log ───────────────────────────────────────────────────

export interface DayCounts {
  /** Entries on the day (ghosts not included) */
  total: number
  open: number
  completed: number
  dropped: number
  events: number
  notes: number
  /** Entries that were moved away from this day */
  ghosts: number
}

export interface MonthView {
  /** Month key, `YYYY-MM` */
  month: string
  start: string
  end: string
  /** Whether today falls in this month */
  current: boolean
  goals: EntryView[]
  /** Future log items for this month that have no day yet */
  undated: EntryView[]
  /** Calendar summary: every day of the month with its counts */
  days: { date: string; weekday: string; isToday: boolean; counts: DayCounts }[]
  /** Open tasks on days of this month, by date */
  open: EntryView[]
  /** Events on days of this month, by date and time */
  events: EntryView[]
}

function countDay(date: string, displays: DisplayEntry[]): DayCounts {
  const counts: DayCounts = { total: 0, open: 0, completed: 0, dropped: 0, events: 0, notes: 0, ghosts: 0 }
  for (const d of displays) {
    if (d.isGhost) {
      if (d.ghostDoc?.date === date) counts.ghosts += 1
      continue
    }
    if (d.entry.date !== date) continue
    counts.total += 1
    if (d.entry.status === 'task') counts.open += 1
    else if (d.entry.status === 'completed') counts.completed += 1
    else if (d.entry.status === 'dropped') counts.dropped += 1
    else if (d.entry.status === 'event') counts.events += 1
    else if (d.entry.status === 'note') counts.notes += 1
  }
  return counts
}

export async function monthLog(bujo: Bujo, month: string, today: string): Promise<MonthView> {
  const days = monthDays(month)
  const [periodEntries, displays] = await Promise.all([
    bujo.getEntriesForPeriod(month),
    bujo.getEntriesForDateRange(days[0], days[days.length - 1]),
  ])
  const dated = displays.filter((d) => !d.isGhost).map((d) => d.entry)
  return {
    month,
    start: days[0],
    end: days[days.length - 1],
    current: monthKey(today) === month,
    goals: sortedViews(periodEntries.filter((e) => e.status === 'goal')),
    undated: sortedViews(periodEntries.filter((e) => e.status !== 'goal')),
    days: days.map((date) => ({
      date,
      weekday: weekdayName(date),
      isToday: date === today,
      counts: countDay(date, displays),
    })),
    open: sortedViews(dated.filter((e) => e.status === 'task'), compareByDate),
    events: sortedViews(dated.filter((e) => e.status === 'event'), compareByDate),
  }
}

// ─── Future log ────────────────────────────────────────────────────

export interface FutureView {
  today: string
  /** Entries with no date at all */
  unscheduled: EntryView[]
  /**
   * What lies ahead, by month: entries on days after today, and future log
   * items dated to this month or a later one. Month-level items come first.
   */
  months: { month: string; entries: EntryView[] }[]
}

export interface FutureOptions {
  /** Include completed and dropped entries (left out by default) */
  includeClosed?: boolean
}

export async function futureLog(bujo: Bujo, today: string, options: FutureOptions = {}): Promise<FutureView> {
  const all = await bujo.getAllEntries()
  const wanted = all.filter((e) => e.status !== 'goal' && (options.includeClosed || !isClosed(e)))
  const thisMonth = monthKey(today)

  const byMonth = new Map<string, BujoEntry[]>()
  for (const entry of wanted) {
    let month: string | null = null
    if (isDayDate(entry.date) && entry.date > today) month = monthKey(entry.date)
    else if (isMonthKey(entry.date) && entry.date >= thisMonth) month = entry.date
    if (month) byMonth.set(month, [...(byMonth.get(month) ?? []), entry])
  }

  // Within a month: items for the month as a whole, then day by day
  const inMonth = (a: BujoEntry, b: BujoEntry) => {
    const aUndated = isMonthKey(a.date)
    const bUndated = isMonthKey(b.date)
    if (aUndated !== bUndated) return aUndated ? -1 : 1
    return compareByDate(a, b)
  }
  return {
    today,
    unscheduled: sortedViews(wanted.filter((e) => e.date === UNSCHEDULED)),
    months: [...byMonth.keys()].sort().map((month) => ({
      month,
      entries: sortedViews(byMonth.get(month) ?? [], inMonth),
    })),
  }
}

// ─── Tags (collections) ────────────────────────────────────────────

export interface TagSummary {
  name: string
  /** Hex color, or null when the tag has no tag document */
  color: string | null
  open: number
  total: number
}

export interface TagView extends TagSummary {
  /** Open entries first (oldest date first), then the rest, newest first */
  entries: EntryView[]
}

export function normalizeTag(name: string): string {
  const tag = name.trim().replace(/^#/, '').toLowerCase()
  if (!tag) throw new InvalidError('Empty tag name')
  return tag
}

export async function tagCollection(bujo: Bujo, name: string, options: { openOnly?: boolean } = {}): Promise<TagView> {
  const tag = normalizeTag(name)
  const [entries, doc] = await Promise.all([bujo.getEntriesForTag(tag), bujo.getTag(tag)])
  const open = entries.filter(isOpen).sort(compareByDate)
  const rest = entries.filter((e) => !isOpen(e)).sort((a, b) => compareByDate(b, a))
  return {
    name: tag,
    color: doc?.color ?? null,
    open: open.length,
    total: entries.length,
    entries: [...open, ...(options.openOnly ? [] : rest)].map(toEntryView),
  }
}

export async function tagList(bujo: Bujo): Promise<{ tags: TagSummary[] }> {
  const [entries, docs] = await Promise.all([bujo.getAllEntries(), bujo.getAllTags()])
  const tags = new Map<string, TagSummary>()
  for (const doc of docs) tags.set(doc.name, { name: doc.name, color: doc.color, open: 0, total: 0 })
  for (const entry of entries) {
    for (const name of entry.tags ?? []) {
      const summary = tags.get(name) ?? { name, color: null, open: 0, total: 0 }
      summary.total += 1
      if (isOpen(entry)) summary.open += 1
      tags.set(name, summary)
    }
  }
  return { tags: [...tags.values()].sort((a, b) => a.name.localeCompare(b.name)) }
}

// ─── Search, stale, detail ─────────────────────────────────────────

export interface SearchOptions {
  openOnly?: boolean
}

/** Case-insensitive body search. Newest date first. */
export async function searchEntries(bujo: Bujo, text: string, options: SearchOptions = {}): Promise<EntryView[]> {
  const needle = text.trim().toLowerCase()
  if (!needle) throw new InvalidError('Empty search text')
  const all = await bujo.getAllEntries()
  return all
    .filter((e) => e.body.toLowerCase().includes(needle) && (!options.openOnly || isOpen(e)))
    .sort((a, b) => compareByDate(b, a))
    .map(toEntryView)
}

export interface EntryDetail {
  entry: EntryView
  /** Days on which the entry has left a ghost (it shows as moved there) */
  ghostDates: string[]
}

export async function entryDetail(bujo: Bujo, entry: BujoEntry): Promise<EntryDetail> {
  const ghosts = await bujo.getGhostsOf(entry._id)
  return {
    entry: toEntryView(entry),
    ghostDates: ghosts.map((g) => g.date).filter((d) => d !== entry.date).sort(),
  }
}

// ─── Review ────────────────────────────────────────────────────────

export interface ReviewView {
  kind: 'week' | 'month'
  /** `YYYY-Www` or `YYYY-MM` */
  period: string
  start: string
  end: string
  /** Whether today falls in the period (the review is of a period still running) */
  current: boolean
  counts: {
    completed: number
    open: number
    dropped: number
    /** Entries carried out of the period: they were on one of its days and now live elsewhere */
    migrated: number
    events: number
    notes: number
    goals: { open: number; achieved: number; dropped: number }
  }
  /** The period's goals, each with its `goalState` */
  goals: EntryView[]
  /** For a weekly review: the goals of the month(s) the week touches */
  monthGoals: { month: string; goals: EntryView[] }[]
  completed: EntryView[]
  /** Open tasks still dated inside the period */
  open: EntryView[]
  dropped: EntryView[]
  /** Carried out of the period; `ghostDate` is the last day in the period they were on */
  migrated: GhostView[]
  /** Open tasks anywhere that have been moved `staleMinMoves`+ times: drop or do? */
  stale: EntryView[]
  staleMinMoves: number
}

export interface ReviewOptions {
  /** Threshold for `stale` (default 3) */
  minMoves?: number
}

/**
 * Everything needed to review a week or a month. Read-only.
 *
 * Counts go by where entries are dated: a task counts as completed in the
 * period it was completed *on* (tasks migrate forward until done).
 */
export async function reviewPeriod(
  bujo: Bujo,
  period: string,
  today: string,
  options: ReviewOptions = {},
): Promise<ReviewView> {
  const kind = dateKind(period)
  if (kind !== 'week' && kind !== 'month') {
    throw new InvalidError(`"${period}" is not a week (YYYY-Www) or month (YYYY-MM)`)
  }
  const { start, end } = periodRange(period)
  const minMoves = options.minMoves ?? 3
  const months = kind === 'week' ? [...new Set([monthKey(start), monthKey(end)])] : []

  const [periodEntries, displays, stale, ...monthGoalLists] = await Promise.all([
    bujo.getEntriesForPeriod(period),
    bujo.getEntriesForDateRange(start, end),
    bujo.getStaleTasks(minMoves),
    ...months.map((m) => bujo.getGoals(m)),
  ])

  const goals = periodEntries.filter((e) => e.status === 'goal')
  // Entries of the period: on one of its days, or (months) dated to the month itself
  const entries = [
    ...periodEntries.filter((e) => e.status !== 'goal'),
    ...displays.filter((d) => !d.isGhost).map((d) => d.entry),
  ]
  const withStatus = (status: BujoStatus) => entries.filter((e) => e.status === status)

  // Carried out: has a ghost inside the period and is now dated outside it
  const carried = new Map<string, DisplayEntry>()
  for (const d of displays) {
    if (!d.isGhost) continue
    const now = d.entry.date
    if (now === period || (isDayDate(now) && now >= start && now <= end)) continue
    const seen = carried.get(d.entry._id)
    if (!seen || (seen.ghostDoc?.date ?? '') < (d.ghostDoc?.date ?? '')) carried.set(d.entry._id, d)
  }
  const migrated = [...carried.values()].sort((a, b) => compareByDate(a.entry, b.entry)).map(toGhostView)

  return {
    kind,
    period,
    start,
    end,
    current: today >= start && today <= end,
    counts: {
      completed: withStatus('completed').length,
      open: withStatus('task').length,
      dropped: withStatus('dropped').length,
      migrated: migrated.length,
      events: withStatus('event').length,
      notes: withStatus('note').length,
      goals: {
        open: goals.filter((g) => !g.goalState).length,
        achieved: goals.filter((g) => g.goalState === 'achieved').length,
        dropped: goals.filter((g) => g.goalState === 'dropped').length,
      },
    },
    goals: sortedViews(goals),
    monthGoals: months.map((month, i) => ({ month, goals: sortedViews(monthGoalLists[i]) })),
    completed: sortedViews(withStatus('completed'), compareByDate),
    open: sortedViews(withStatus('task'), compareByDate),
    dropped: sortedViews(withStatus('dropped'), compareByDate),
    migrated,
    stale: stale.map(toEntryView),
    staleMinMoves: minMoves,
  }
}
