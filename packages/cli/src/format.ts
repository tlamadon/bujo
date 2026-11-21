// Human-readable rendering of core's view objects.

import {
  monthKey,
  weekdayOf,
  type DayView,
  type EntryDetail,
  type EntryView,
  type FutureView,
  type GhostView,
  type MonthView,
  type ReviewView,
  type TagSummary,
  type TagView,
  type TodayView,
  type WeekView,
} from '@bujo/core'

const SGR = {
  bold: [1, 22],
  dim: [2, 22],
  underline: [4, 24],
  strike: [9, 29],
  red: [31, 39],
  green: [32, 39],
  yellow: [33, 39],
  blue: [34, 39],
  cyan: [36, 39],
} as const

type StyleName = keyof typeof SGR

export interface Fmt {
  color: boolean
  /** Today's date, for "today" / "tomorrow" labels */
  today: string
}

function paint(f: Fmt, text: string, ...styles: StyleName[]): string {
  if (!f.color || !text) return text
  let out = text
  for (const style of styles) out = `\x1b[${SGR[style][0]}m${out}\x1b[${SGR[style][1]}m`
  return out
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** `2026-11-21` → `Sat 21 Nov` (with the year when asked) */
export function formatDay(day: string, withYear = false): string {
  const [year, month, date] = day.split('-').map(Number)
  const text = `${WEEKDAYS[weekdayOf(day) - 1]} ${date} ${MONTHS[month - 1]}`
  return withYear ? `${text} ${year}` : text
}

/** `2026-11` → `November 2026` */
export function formatMonth(month: string): string {
  const [year, m] = month.split('-').map(Number)
  return `${MONTH_NAMES[m - 1]} ${year}`
}

function relativeDay(day: string, today: string): string {
  const diff = Math.round((Date.parse(day) - Date.parse(today)) / 86_400_000)
  if (diff === 0) return 'today'
  if (diff === 1) return 'tomorrow'
  if (diff === -1) return 'yesterday'
  return ''
}

// ─── Entry lines ───────────────────────────────────────────────────

/** The signifier for an entry; a ghost shows where the entry went instead. */
function bullet(entry: EntryView, ghost: boolean): string {
  if (ghost) return entry.dateKind === 'day' ? '>' : '<'
  switch (entry.status) {
    case 'task':
    case 'dropped':
      return '•'
    case 'completed':
      return '×'
    case 'migrated':
      return '>'
    case 'scheduled':
      return '<'
    case 'note':
      return '–'
    case 'event':
      return '○'
    case 'goal':
      return entry.goalState === 'achieved' ? '◆' : '◇'
  }
}

function isDropped(entry: EntryView): boolean {
  return entry.status === 'dropped' || entry.goalState === 'dropped'
}

function bodyText(entry: EntryView, f: Fmt, ghost: boolean): string {
  if (isDropped(entry)) {
    // No strikethrough without ANSI codes: fall back to ~~text~~
    return f.color ? paint(f, entry.body, 'strike', 'dim') : `~~${entry.body}~~`
  }
  if (ghost || entry.status === 'completed' || entry.goalState === 'achieved') {
    return paint(f, entry.body, 'dim')
  }
  return f.color ? entry.body.replace(/#[a-zA-Z0-9_-]+/g, (tag) => paint(f, tag, 'cyan')) : entry.body
}

export interface LineOptions {
  /** Prefix the line with the entry's date (for lists spanning dates) */
  showDate?: boolean
  /** Render as a ghost: the entry was here and moved away */
  ghost?: boolean
}

/** One entry: `  ref  [date]  *• [time] text  (notes)` */
export function entryLine(entry: EntryView, f: Fmt, options: LineOptions = {}): string {
  const ghost = !!options.ghost
  const parts = [`  ${paint(f, entry.ref.padEnd(6), 'dim')}`]
  if (options.showDate) parts.push(paint(f, entry.date.padEnd(11), 'dim'))

  const star = entry.priority ? paint(f, '*', 'yellow', 'bold') : ' '
  const sign = bullet(entry, ghost)
  const signColor: StyleName | null =
    ghost || isDropped(entry) ? 'dim'
    : entry.status === 'completed' || entry.goalState === 'achieved' ? 'green'
    : entry.status === 'goal' ? 'yellow'
    : null
  let line = `${star}${signColor ? paint(f, sign, signColor) : sign} `
  if (entry.time) line += `${entry.time} `
  line += bodyText(entry, f, ghost)

  if (ghost) {
    line += paint(f, `  → ${entry.date}`, 'dim')
  } else if (entry.moves > 0 && entry.open) {
    line += paint(f, `  (moved ${entry.moves}×)`, entry.moves >= 3 ? 'yellow' : 'dim')
  }
  parts.push(line)
  return parts.join('  ')
}

function entryLines(entries: EntryView[], f: Fmt, options: LineOptions = {}): string[] {
  return entries.map((e) => entryLine(e, f, options))
}

function ghostLines(ghosts: GhostView[], f: Fmt): string[] {
  return ghosts.map((g) => entryLine(g, f, { ghost: true }))
}

function heading(f: Fmt, ...parts: (string | false | undefined)[]): string {
  const [first, ...rest] = parts.filter((p): p is string => !!p)
  return [paint(f, first, 'bold'), ...rest.map((r) => paint(f, r, 'dim'))].join(paint(f, ' · ', 'dim'))
}

function section(f: Fmt, title: string, lines: string[], empty?: string): string[] {
  if (lines.length === 0 && empty === undefined) return []
  return ['', paint(f, title, 'bold'), ...(lines.length > 0 ? lines : [paint(f, `  ${empty}`, 'dim')])]
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

// ─── Views ─────────────────────────────────────────────────────────

function dayBody(day: DayView, f: Fmt): string[] {
  const lines = [...entryLines(day.entries, f), ...ghostLines(day.ghosts, f)]
  return lines.length > 0 ? lines : [paint(f, '  (nothing)', 'dim')]
}

export function renderDay(view: TodayView, f: Fmt): string {
  const lines = [
    heading(f, formatDay(view.date, true), relativeDay(view.date, f.today), view.week),
    '',
    ...dayBody(view, f),
  ]
  if (view.overdue.length > 0) {
    lines.push(
      '',
      paint(
        f,
        `${plural(view.overdue.length, 'open task')} left on earlier days — run \`bujo migrate\``,
        'yellow',
      ),
    )
  }
  return lines.join('\n')
}

export function renderWeek(view: WeekView, f: Fmt): string {
  const lines = [
    heading(
      f,
      `Week ${view.week}`,
      `${formatDay(view.start)} – ${formatDay(view.end, true)}`,
      view.current && 'this week',
    ),
    ...section(f, 'Goals', entryLines(view.goals, f), 'no goals — add one with `bujo goal "…"`'),
  ]
  for (const day of view.days) {
    lines.push('', heading(f, formatDay(day.date), day.isToday && 'today'), ...dayBody(day, f))
  }
  return lines.join('\n')
}

function calendar(view: MonthView, f: Fmt): string[] {
  const lines = [`  ${WEEKDAYS.map((d) => d.slice(0, 2).padStart(4)).join(' ')}`]
  let row: string[] = new Array<string>(weekdayOf(view.start) - 1).fill('     ')
  for (const day of view.days) {
    const c = day.counts
    // One mark per day: what most deserves attention there
    const mark = c.open > 0 ? '•' : c.events > 0 ? '○' : c.completed > 0 ? '×' : c.total > 0 ? '–' : ' '
    const number = String(Number(day.date.slice(-2))).padStart(3)
    const cell = `${day.isToday ? paint(f, number, 'bold', 'underline') : number}${mark}`
    row.push(day.isToday && !f.color ? `[${cell.trim()}]`.padStart(5) : ` ${cell}`)
    if (row.length === 7) {
      lines.push(`  ${row.join('')}`.trimEnd())
      row = []
    }
  }
  if (row.length > 0) lines.push(`  ${row.join('')}`.trimEnd())
  lines.push(paint(f, '  • open   ○ event   × done   – other', 'dim'))
  return lines
}

export function renderMonth(view: MonthView, f: Fmt): string {
  return [
    heading(f, formatMonth(view.month), view.current && 'this month'),
    ...section(f, 'Goals', entryLines(view.goals, f), 'no goals — add one with `bujo goal "…" --month`'),
    ...section(f, 'This month, no day yet', entryLines(view.undated, f)),
    '',
    ...calendar(view, f),
    ...section(f, 'Open tasks', entryLines(view.open, f, { showDate: true }), 'none'),
    ...section(f, 'Events', entryLines(view.events, f, { showDate: true })),
  ].join('\n')
}

export function renderFuture(view: FutureView, f: Fmt): string {
  const lines = [
    heading(f, 'Future log'),
    ...section(f, 'Unscheduled', entryLines(view.unscheduled, f), 'nothing unscheduled'),
  ]
  for (const group of view.months) {
    lines.push(
      ...section(
        f,
        group.month === monthKey(view.today) ? `${formatMonth(group.month)} (rest of this month)` : formatMonth(group.month),
        entryLines(group.entries, f, { showDate: true }),
      ),
    )
  }
  return lines.join('\n')
}

export function renderTag(view: TagView, f: Fmt): string {
  return [
    heading(f, `#${view.name}`, `${view.open} open`, `${view.total} total`),
    '',
    ...(view.entries.length > 0
      ? entryLines(view.entries, f, { showDate: true })
      : [paint(f, view.total > 0 ? '  (nothing open)' : '  (no entries with this tag)', 'dim')]),
  ].join('\n')
}

export function renderTags(tags: TagSummary[], f: Fmt): string {
  if (tags.length === 0) return paint(f, 'No tags yet. Add #tags to entries to create collections.', 'dim')
  const width = Math.max(...tags.map((t) => t.name.length)) + 1
  return tags
    .map((t) => `  ${paint(f, `#${t.name}`.padEnd(width + 1), 'cyan')} ${String(t.open).padStart(3)} open ${paint(f, `/ ${t.total}`, 'dim')}`)
    .join('\n')
}

/** A flat list of entries from anywhere in the journal. */
export function renderList(title: string, entries: EntryView[], f: Fmt, empty: string): string {
  return [
    heading(f, title, plural(entries.length, 'entry', 'entries')),
    '',
    ...(entries.length > 0 ? entryLines(entries, f, { showDate: true }) : [paint(f, `  ${empty}`, 'dim')]),
  ].join('\n')
}

export function renderDetail(detail: EntryDetail, f: Fmt): string {
  const e = detail.entry
  const state =
    e.goalState ? `goal (${e.goalState})`
    : e.open ? `${e.status} (open)`
    : e.status
  const rows: [string, string][] = [
    ['id', e.id],
    ['status', state],
    ['date', e.dateKind === 'day' ? `${e.date} (${formatDay(e.date)})` : e.date],
  ]
  if (e.time) rows.push(['time', e.time])
  rows.push(['priority', e.priority ? 'yes' : 'no'])
  if (e.tags.length > 0) rows.push(['tags', e.tags.map((t) => `#${t}`).join(' ')])
  rows.push(['created', e.createdAt.replace('T', ' ').slice(0, 16) + ' UTC'])
  rows.push(['moves', String(e.moves)])
  if (e.dateHistory.length > 0) rows.push(['history', [...e.dateHistory, `${e.date} (now)`].join(' → ')])
  return [entryLine(e, f).trimStart(), ...rows.map(([k, v]) => `  ${paint(f, k.padEnd(9), 'dim')} ${v}`)].join('\n')
}

export function renderReview(view: ReviewView, f: Fmt): string {
  const c = view.counts
  const title = view.kind === 'week' ? `Review of week ${view.period}` : `Review of ${formatMonth(view.period)}`
  const lines = [
    heading(
      f,
      title,
      `${formatDay(view.start)} – ${formatDay(view.end, true)}`,
      view.current && 'still running',
    ),
    '',
    `  ${plural(c.completed, 'completed', 'completed')} · ${c.open} open · ${c.dropped} dropped · ` +
      `${c.migrated} migrated · ${plural(c.events, 'event')} · ${plural(c.notes, 'note')}`,
    `  goals: ${c.goals.achieved} achieved · ${c.goals.open} open · ${c.goals.dropped} dropped`,
    ...section(f, 'Goals', entryLines(view.goals, f), 'none set'),
  ]
  for (const group of view.monthGoals) {
    lines.push(...section(f, `Goals for ${formatMonth(group.month)}`, entryLines(group.goals, f)))
  }
  lines.push(
    ...section(f, 'Completed', entryLines(view.completed, f, { showDate: true })),
    ...section(f, 'Still open', entryLines(view.open, f, { showDate: true })),
    ...section(f, 'Dropped', entryLines(view.dropped, f, { showDate: true })),
    ...section(f, 'Migrated out', ghostLines(view.migrated, f)),
    ...section(
      f,
      `Stale — moved ${view.staleMinMoves}+ times: drop or do?`,
      entryLines(view.stale, f, { showDate: true }),
    ),
  )
  return lines.join('\n')
}

/** `verb  ref  • text` lines reporting what a command did to each entry. */
export function renderChanges(changes: { verb: string; entry: EntryView; note?: string }[], f: Fmt): string {
  const width = Math.max(...changes.map((c) => c.verb.length))
  return changes
    .map((c) => `${paint(f, c.verb.padEnd(width), 'green')}${entryLine(c.entry, f)}${c.note ? paint(f, `  ${c.note}`, 'dim') : ''}`)
    .join('\n')
}

export interface Check {
  name: string
  status: 'ok' | 'warn' | 'fail'
  detail: string
}

export function renderChecks(checks: Check[], f: Fmt): string {
  const marks = { ok: paint(f, 'ok  ', 'green'), warn: paint(f, 'warn', 'yellow'), fail: paint(f, 'FAIL', 'red', 'bold') }
  const width = Math.max(...checks.map((c) => c.name.length))
  return checks.map((c) => `${marks[c.status]}  ${c.name.padEnd(width)}  ${c.detail}`).join('\n')
}

export function renderTable(rows: [string, string][], f: Fmt): string {
  const width = Math.max(...rows.map(([k]) => k.length))
  return rows.map(([k, v]) => `${paint(f, k.padEnd(width), 'dim')}  ${v}`).join('\n')
}
