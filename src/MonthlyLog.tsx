import { useMemo } from 'react'
import {
  addMonths,
  monthDays,
  monthKey,
  stripTags,
  weekdayOf,
  type BujoEntry,
} from './db'
import EditableEntry from './EditableEntry'
import { formatDayLong, formatDayShort, formatMonth, formatWeekday } from './format'
import { useEntriesForDateRange } from './hooks'
import PeriodHeader from './PeriodHeader'
import PeriodSection from './PeriodSection'
import { relativeMonthLabel } from './relativeLabel'
import { dayRoute, monthRoute, navigate } from './router'
import { compareEntries, entryClass, entryIcon } from './statusMeta'
import { useStableList } from './useStableList'

/** How many entries a calendar cell spells out on a wide screen */
const MAX_SNIPPETS = 3

// 2024-01-01 was a Monday: seven days from there name the columns.
const WEEKDAY_NAMES = Array.from({ length: 7 }, (_, i) => formatWeekday(`2024-01-0${i + 1}`))

const entryId = (entry: BujoEntry) => entry._id

/** Still to do or to attend: what the list under the calendar is for */
const isUpcoming = (entry: BujoEntry) =>
  entry.status === 'task' || entry.status === 'event' || entry.status === 'scheduled'

const compareByDate = (a: BujoEntry, b: BujoEntry) =>
  a.date.localeCompare(b.date) ||
  (a.time ?? '').localeCompare(b.time ?? '') ||
  a.createdAt - b.createdAt

interface Props {
  /** YYYY-MM */
  month: string
  today: string
  onOpenDetail?: (entry: BujoEntry) => void
  onTagClick?: (tagName: string) => void
}

export default function MonthlyLog({ month, today, onOpenDetail, onTagClick }: Props) {
  const days = useMemo(() => monthDays(month), [month])
  const rawEntries = useEntriesForDateRange(days[0], days[days.length - 1])

  // Real entries per day (ghosts say where something used to be: not shown here)
  const byDate = useMemo(() => {
    const map: Record<string, BujoEntry[]> = {}
    for (const de of rawEntries ?? []) {
      if (!de.isGhost) (map[de.entry.date] ??= []).push(de.entry)
    }
    for (const list of Object.values(map)) list.sort(compareEntries)
    return map
  }, [rawEntries])

  // On a day of the month. What belongs to the month as a whole is listed in its own section.
  const allEntries = useMemo(() => rawEntries?.filter((de) => !de.isGhost).map((de) => de.entry), [rawEntries])

  const upcoming = useStableList(allEntries, {
    id: entryId,
    compare: compareByDate,
    include: isUpcoming,
    resetKey: month,
  })

  const goTo = (target: string) => navigate(monthRoute(target, today), { replace: true })
  const leadingBlanks = weekdayOf(days[0]) - 1

  return (
    <div className="monthly-log">
      <PeriodHeader
        title={formatMonth(month)}
        relative={relativeMonthLabel(month, today)}
        unit="month"
        isCurrent={month === monthKey(today)}
        pickerValue={month === monthKey(today) ? today : days[0]}
        onPrev={() => goTo(addMonths(month, -1))}
        onNext={() => goTo(addMonths(month, 1))}
        onCurrent={() => goTo(monthKey(today))}
        onPick={(day) => goTo(monthKey(day))}
      />

      <div className="month-layout">
        <div className="month-period">
          <PeriodSection
            period={month}
            title={month === monthKey(today) ? 'This month' : 'For the month'}
            addLabel="Add a task for the month"
            onOpenDetail={onOpenDetail}
            onTagClick={onTagClick}
          />
        </div>

        <div className="month-calendar">
          <div className="month-weekdays" aria-hidden="true">
            {WEEKDAY_NAMES.map((name) => (
              <span key={name}>{name}</span>
            ))}
          </div>
          <div className="month-grid">
            {Array.from({ length: leadingBlanks }, (_, i) => (
              <span key={`blank-${i}`} className="month-blank" />
            ))}
            {days.map((date) => {
              const dayEntries = byDate[date] ?? []
              const has = (...statuses: string[]) => dayEntries.some((e) => statuses.includes(e.status))
              const count = dayEntries.length
              return (
                <button
                  key={date}
                  type="button"
                  className={`month-cell ${date === today ? 'today' : ''} ${count > 0 ? 'has-entries' : ''}`}
                  onClick={() => navigate(dayRoute(date, today))}
                  aria-label={`${formatDayLong(date, today)}, ${count} ${count === 1 ? 'entry' : 'entries'}`}
                >
                  <span className="month-day-num">{Number(date.slice(8))}</span>
                  {count > 0 && (
                    <span className="month-dots">
                      {has('task') && <span className="dot dot-task" />}
                      {has('completed') && <span className="dot dot-completed" />}
                      {has('scheduled', 'migrated') && <span className="dot dot-rescheduled" />}
                      {has('note') && <span className="dot dot-note" />}
                      {has('event') && <span className="dot dot-event" />}
                    </span>
                  )}
                  {/* Wide screens have room for the entries themselves */}
                  {count > 0 && (
                    <span className="month-snippets">
                      {dayEntries.slice(0, MAX_SNIPPETS).map((entry) => (
                        <span key={entry._id} className={`month-snippet ${entryClass(entry)}`}>
                          <span className="month-snippet-icon">{entryIcon(entry)}</span>
                          {stripTags(entry.body) || entry.body}
                        </span>
                      ))}
                      {count > MAX_SNIPPETS && (
                        <span className="month-snippet month-snippet-more">+{count - MAX_SNIPPETS} more</span>
                      )}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          <div className="month-legend" aria-hidden="true">
            <span className="month-legend-item"><span className="dot dot-task" /> Open</span>
            <span className="month-legend-item"><span className="dot dot-completed" /> Done</span>
            <span className="month-legend-item"><span className="dot dot-rescheduled" /> Moved</span>
            <span className="month-legend-item"><span className="dot dot-note" /> Note</span>
            <span className="month-legend-item"><span className="dot dot-event" /> Event</span>
          </div>
        </div>

        <section className="month-task-list">
          <h3>Open tasks &amp; events</h3>
          {upcoming === undefined ? (
            <p className="loading">Loading…</p>
          ) : upcoming.length === 0 ? (
            <p className="empty">No open tasks or events this month.</p>
          ) : (
            <ul className="entry-list">
              {upcoming.map((entry) => (
                <li key={entry._id} className={`entry ${entryClass(entry)}`}>
                  <EditableEntry
                    entry={entry}
                    meta={formatDayShort(entry.date)}
                    onOpenDetail={onOpenDetail}
                    onTagClick={onTagClick}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
