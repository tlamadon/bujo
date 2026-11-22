// Read models: the data behind each journal view, as plain JSON.
//
// This is the stable machine-readable interface (the CLI's `--json` output
// is exactly these objects). Anything a front end shows — CLI, MCP server —
// should come from here, so they all agree.

import {
  dateKind,
  isDayDate,
  isMonthKey,
  isWeekKey,
  isoWeekKey,
  monthDays,
  monthKey,
  periodRange,
  weekDays,
  weekStart,
  weekdayOf,
  type DateKind,
} from './dates'
import { InvalidError } from './errors'
import { NO_FAMILIES, familyIndex, type FamilyIndex, type Progress } from './family'
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
  /** Still to do: an open task */
  open: boolean
  /** `HH:MM` for timed events, otherwise null */
  time: string | null
  /** The entry this one is a subtask of, or null */
  parent: { ref: string; text: string } | null
  /** For an epic (an entry with subtasks): how far along it is. Null for everything else */
  subtasks: Progress | null
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

/** Parent/subtask links across the whole journal, for filling in `parent` and `subtasks`. */
export async function loadFamilies(bujo: Bujo): Promise<FamilyIndex> {
  return familyIndex(await bujo.getAllEntries())
}

/**
 * An entry as shown to the outside. Without `families` the entry is described
 * on its own: `parent` and `subtasks` are then null whatever the links are.
 */
export function toEntryView(entry: BujoEntry, families: FamilyIndex = NO_FAMILIES): EntryView {
  const parent = families.parentOf(entry)
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
    parent: parent ? { ref: refOf(parent._id), text: stripTags(parent.body) } : null,
    subtasks: families.progressOf(entry),
    dateHistory: (entry.dateHistory ?? []).map(displayDate),
    moves: movesOf(entry),
    createdAt: new Date(entry.createdAt).toISOString(),
  }
}

function toGhostView(display: DisplayEntry, families: FamilyIndex): GhostView {
  return { ...toEntryView(display.entry, families), ghostDate: display.ghostDoc?.date ?? display.entry.date }
}

/** Reading order within a day: what needs doing first, what is settled last. */
function dayRank(entry: BujoEntry): number {
  switch (entry.status) {
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

/**
 * Where a date falls on the calendar, as a sortable string: a month comes
 * before its days, a week just before its Monday, no date after everything.
 */
function calendarKey(date: string): string {
  switch (dateKind(date)) {
    case 'month':
      return `${date}-00`
    case 'week':
      return `${weekStart(date)} `
    case 'day':
      return `${date}!`
    default:
      return '~'
  }
}

/** Chronological: by date, then by reading order within the date. */
function compareByDate(a: BujoEntry, b: BujoEntry): number {
  if (a.date !== b.date) return calendarKey(a.date) < calendarKey(b.date) ? -1 : 1
  return compareInDay(a, b)
}

function sortedViews(entries: BujoEntry[], families: FamilyIndex, compare = compareInDay): EntryView[] {
  return [...entries].sort(compare).map((entry) => toEntryView(entry, families))
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
   * Open tasks left behind on earlier days, in earlier weeks and in earlier
   * months. Only filled when `date` is today; `migrate` carries them forward.
   */
  overdue: EntryView[]
}

function toDayView(date: string, today: string, displays: DisplayEntry[], families: FamilyIndex): DayView {
  const here = displays.filter((d) => (d.isGhost ? d.ghostDoc?.date === date : d.entry.date === date))
  return {
    date,
    weekday: weekdayName(date),
    isToday: date === today,
    entries: sortedViews(here.filter((d) => !d.isGhost).map((d) => d.entry), families),
    ghosts: here
      .filter((d) => d.isGhost)
      .sort((a, b) => a.entry.createdAt - b.entry.createdAt)
      .map((d) => toGhostView(d, families)),
  }
}

/** The daily log for `date`. */
export async function dayLog(bujo: Bujo, date: string, today: string): Promise<TodayView> {
  if (!isDayDate(date)) throw new InvalidError(`"${date}" is not a day (YYYY-MM-DD)`)
  const [displays, families] = await Promise.all([bujo.getEntriesForDate(date), loadFamilies(bujo)])
  const overdue = date === today ? await bujo.getOverdueTasks(today) : []
  return {
    ...toDayView(date, today, displays, families),
    week: isoWeekKey(date),
    overdue: overdue.map((entry) => toEntryView(entry, families)),
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
  /** Entries for the week as a whole, with no day yet */
  undated: EntryView[]
  /** Monday to Sunday */
  days: DayView[]
}

export async function weekLog(bujo: Bujo, week: string, today: string): Promise<WeekView> {
  const days = weekDays(week)
  const [undated, displays, families] = await Promise.all([
    bujo.getEntriesForPeriod(week),
    bujo.getEntriesForDateRange(days[0], days[6]),
    loadFamilies(bujo),
  ])
  return {
    week,
    start: days[0],
    end: days[6],
    current: isoWeekKey(today) === week,
    undated: sortedViews(undated, families),
    days: days.map((day) => toDayView(day, today, displays, families)),
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
  /** Entries for the month as a whole, with no day yet */
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
  const [periodEntries, displays, families] = await Promise.all([
    bujo.getEntriesForPeriod(month),
    bujo.getEntriesForDateRange(days[0], days[days.length - 1]),
    loadFamilies(bujo),
  ])
  const dated = displays.filter((d) => !d.isGhost).map((d) => d.entry)
  return {
    month,
    start: days[0],
    end: days[days.length - 1],
    current: monthKey(today) === month,
    undated: sortedViews(periodEntries, families),
    days: days.map((date) => ({
      date,
      weekday: weekdayName(date),
      isToday: date === today,
      counts: countDay(date, displays),
    })),
    open: sortedViews(dated.filter((e) => e.status === 'task'), families, compareByDate),
    events: sortedViews(dated.filter((e) => e.status === 'event'), families, compareByDate),
  }
}

// ─── Future log ────────────────────────────────────────────────────

export interface FutureView {
  today: string
  /** Entries with no date at all */
  unscheduled: EntryView[]
  /**
   * What lies ahead, by month: entries on days after today, in weeks after
   * this one (under the month their Monday falls in), and dated to this month
   * or a later one. Month-level items come first.
   */
  months: { month: string; entries: EntryView[] }[]
}

export interface FutureOptions {
  /** Include completed and dropped entries (left out by default) */
  includeClosed?: boolean
}

export async function futureLog(bujo: Bujo, today: string, options: FutureOptions = {}): Promise<FutureView> {
  const all = await bujo.getAllEntries()
  const families = familyIndex(all)
  const wanted = all.filter((e) => options.includeClosed || !isClosed(e))
  const thisMonth = monthKey(today)
  const thisWeek = isoWeekKey(today)

  const byMonth = new Map<string, BujoEntry[]>()
  for (const entry of wanted) {
    let month: string | null = null
    if (isDayDate(entry.date) && entry.date > today) month = monthKey(entry.date)
    else if (isWeekKey(entry.date) && entry.date > thisWeek) month = monthKey(weekStart(entry.date))
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
    unscheduled: sortedViews(wanted.filter((e) => e.date === UNSCHEDULED), families),
    months: [...byMonth.keys()].sort().map((month) => ({
      month,
      entries: sortedViews(byMonth.get(month) ?? [], families, inMonth),
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
  const [entries, doc, families] = await Promise.all([bujo.getEntriesForTag(tag), bujo.getTag(tag), loadFamilies(bujo)])
  const open = entries.filter(isOpen).sort(compareByDate)
  const rest = entries.filter((e) => !isOpen(e)).sort((a, b) => compareByDate(b, a))
  return {
    name: tag,
    color: doc?.color ?? null,
    open: open.length,
    total: entries.length,
    entries: [...open, ...(options.openOnly ? [] : rest)].map((entry) => toEntryView(entry, families)),
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
  const families = familyIndex(all)
  return all
    .filter((e) => e.body.toLowerCase().includes(needle) && (!options.openOnly || isOpen(e)))
    .sort((a, b) => compareByDate(b, a))
    .map((entry) => toEntryView(entry, families))
}

export interface EntryDetail {
  entry: EntryView
  /** Its subtasks, oldest first (empty unless the entry is an epic) */
  subtasks: EntryView[]
  /** Days on which the entry has left a ghost (it shows as moved there) */
  ghostDates: string[]
}

export async function entryDetail(bujo: Bujo, entry: BujoEntry): Promise<EntryDetail> {
  const [ghosts, families] = await Promise.all([bujo.getGhostsOf(entry._id), loadFamilies(bujo)])
  return {
    entry: toEntryView(entry, families),
    subtasks: families.childrenOf(entry).map((child) => toEntryView(child, families)),
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
    /** Entries carried out of the period: they were in it and now live elsewhere */
    migrated: number
    events: number
    notes: number
  }
  /**
   * For a weekly review: what the month(s) the week touches hold for the month
   * as a whole — the larger aims the week sits under.
   */
  monthTasks: { month: string; entries: EntryView[] }[]
  completed: EntryView[]
  /** Open tasks still dated inside the period */
  open: EntryView[]
  dropped: EntryView[]
  /** Carried out of the period; `ghostDate` is where in the period they last were */
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
 * The period's entries are those on one of its days, those dated to the
 * period as a whole and, for a month, those dated to a week starting in it.
 * Counts go by where entries are dated: a task counts as completed in the
 * period it was completed *in* (tasks migrate forward until done).
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

  const [periodEntries, displays, stale, all, ...monthLists] = await Promise.all([
    bujo.getEntriesForPeriod(period),
    bujo.getEntriesForDateRange(start, end),
    bujo.getStaleTasks(minMoves),
    bujo.getAllEntries(),
    ...months.map((m) => bujo.getEntriesForPeriod(m)),
  ])
  const families = familyIndex(all)

  const within = (day: string) => day >= start && day <= end
  const inPeriod = (date: string) =>
    date === period ||
    (isDayDate(date) && within(date)) ||
    // A week belongs to the month its Monday falls in
    (kind === 'month' && isWeekKey(date) && within(weekStart(date)))

  const entries = [
    ...periodEntries,
    ...(kind === 'month' ? all.filter((e) => isWeekKey(e.date) && inPeriod(e.date)) : []),
    ...displays.filter((d) => !d.isGhost).map((d) => d.entry),
  ]
  const withStatus = (status: BujoStatus) => entries.filter((e) => e.status === status)

  // Carried out: was in the period, is now dated outside it. A day keeps a
  // ghost of what left it; the period itself only shows in the date history.
  const carried = new Map<string, DisplayEntry>()
  for (const d of displays) {
    if (!d.isGhost || inPeriod(d.entry.date)) continue
    const seen = carried.get(d.entry._id)
    if (!seen || (seen.ghostDoc?.date ?? '') < (d.ghostDoc?.date ?? '')) carried.set(d.entry._id, d)
  }
  const migrated = [...carried.values()].map((d) => toGhostView(d, families))
  for (const entry of all) {
    if (carried.has(entry._id) || inPeriod(entry.date) || !entry.dateHistory?.includes(period)) continue
    migrated.push({ ...toEntryView(entry, families), ghostDate: period })
  }
  migrated.sort((a, b) => (a.date === b.date ? 0 : calendarKey(a.date) < calendarKey(b.date) ? -1 : 1))

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
    },
    monthTasks: months.map((month, i) => ({ month, entries: sortedViews(monthLists[i], families) })),
    completed: sortedViews(withStatus('completed'), families, compareByDate),
    open: sortedViews(withStatus('task'), families, compareByDate),
    dropped: sortedViews(withStatus('dropped'), families, compareByDate),
    migrated,
    stale: stale.map((entry) => toEntryView(entry, families)),
    staleMinMoves: minMoves,
  }
}
