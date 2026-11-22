import { useMemo, useState } from 'react'
import { addEntry, addWeeks, isoWeekKey, stripTags, weekDays, type BujoEntry, type DisplayEntry } from './db'
import EditableEntry from './EditableEntry'
import { formatDateCompact, formatDayShort, formatWeekRange, formatWeekday } from './format'
import GoalsSection from './GoalsSection'
import { useEntriesForDateRange } from './hooks'
import { Plus } from './Icons'
import PeriodHeader from './PeriodHeader'
import QuickAdd from './QuickAdd'
import { relativeWeekLabel } from './relativeLabel'
import { dayRoute, navigate, routeForDate, weekRoute } from './router'
import { compareDisplayEntries, displayEntryKey, entryClass } from './statusMeta'
import { useStableList } from './useStableList'

interface Props {
  /** ISO week, YYYY-Www */
  week: string
  today: string
  onOpenDetail?: (entry: BujoEntry) => void
  onTagClick?: (tagName: string) => void
}

export default function WeeklyLog({ week, today, onOpenDetail, onTagClick }: Props) {
  const days = useMemo(() => weekDays(week), [week])
  const rawEntries = useEntriesForDateRange(days[0], days[6])
  const entries = useStableList(rawEntries, {
    id: displayEntryKey,
    compare: compareDisplayEntries,
    resetKey: week,
  })

  // Group by the day each entry appears on (a ghost appears where it was left)
  const byDate = useMemo(() => {
    const map: Record<string, DisplayEntry[]> = {}
    for (const d of days) map[d] = []
    for (const de of entries ?? []) {
      map[de.isGhost ? de.ghostDoc!.date : de.entry.date]?.push(de)
    }
    return map
  }, [entries, days])

  const [addingDay, setAddingDay] = useState<string | null>(null)

  const goTo = (target: string) => navigate(weekRoute(target, today), { replace: true })

  return (
    <div className="weekly-log">
      <PeriodHeader
        title={formatWeekRange(week)}
        relative={`${relativeWeekLabel(week, today)} · ${week.slice(5)}`}
        unit="week"
        isCurrent={week === isoWeekKey(today)}
        pickerValue={days[0]}
        onPrev={() => goTo(addWeeks(week, -1))}
        onNext={() => goTo(addWeeks(week, 1))}
        onCurrent={() => goTo(isoWeekKey(today))}
        onPick={(day) => goTo(isoWeekKey(day))}
      />

      <GoalsSection period={week} title="Goals this week" onOpenDetail={onOpenDetail} onTagClick={onTagClick} />

      <div className="week-grid">
        {days.map((date) => {
          const dayEntries = byDate[date]
          const adding = addingDay === date
          return (
            <section key={date} className={`week-day ${date === today ? 'today' : ''}`}>
              <div className="card-header">
                <button
                  type="button"
                  className="week-day-label"
                  onClick={() => navigate(dayRoute(date, today))}
                  title="Open this day"
                >
                  <strong>{formatWeekday(date)}</strong> <span className="week-day-date">{formatDayShort(date)}</span>
                </button>
                <button
                  type="button"
                  className="add-btn"
                  onClick={() => setAddingDay(adding ? null : date)}
                  aria-label={`Add task on ${formatWeekday(date)} ${formatDayShort(date)}`}
                  aria-expanded={adding}
                  title="Add task"
                >
                  <span className="add-btn-box">
                    <Plus />
                  </span>
                </button>
              </div>

              {adding && (
                <QuickAdd
                  placeholder="New task…"
                  onAdd={(body) => addEntry(date, 'task', body)}
                  onDone={() => setAddingDay(null)}
                />
              )}

              {entries === undefined ? (
                <div className="card-empty">…</div>
              ) : dayEntries.length === 0 ? (
                <div className="card-empty">—</div>
              ) : (
                <ul className="entry-list compact">
                  {dayEntries.map((de) => (
                    <li
                      key={displayEntryKey(de)}
                      className={`entry ${de.isGhost ? 'status-scheduled ghost-entry' : entryClass(de.entry)}`}
                    >
                      {de.isGhost ? (
                        <button
                          type="button"
                          className="ghost-link"
                          onClick={() => navigate(routeForDate(de.entry.date, today))}
                          title="Rescheduled — go to where it is now"
                        >
                          <span className="ghost-signifier" aria-hidden="true">
                            &gt;
                          </span>
                          <span className="ghost-body">{stripTags(de.entry.body) || de.entry.body}</span>
                          <span className="ghost-label">→ {formatDateCompact(de.entry.date)}</span>
                        </button>
                      ) : (
                        <EditableEntry entry={de.entry} onOpenDetail={onOpenDetail} onTagClick={onTagClick} />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
