import { addDays, addEntry, stripTags, type BujoEntry } from './db'
import Composer from './Composer'
import EditableEntry from './EditableEntry'
import { migrateWithUndo } from './entryActions'
import { formatDateCompact, formatDayLong } from './format'
import { useEntriesForDate, useOverdueCount } from './hooks'
import PeriodHeader from './PeriodHeader'
import { relativeDayLabel } from './relativeLabel'
import { dayRoute, navigate, routeForDate } from './router'
import { compareDisplayEntries, displayEntryKey, entryClass } from './statusMeta'
import { showError } from './toast'
import { useStableList } from './useStableList'

interface Props {
  date: string
  today: string
  onOpenDetail?: (entry: BujoEntry) => void
  onTagClick?: (tagName: string) => void
}

export default function DailyLog({ date, today, onOpenDetail, onTagClick }: Props) {
  const rawEntries = useEntriesForDate(date)
  const entries = useStableList(rawEntries, {
    id: displayEntryKey,
    compare: compareDisplayEntries,
    resetKey: date,
  })
  const overdue = useOverdueCount(today)

  const goTo = (day: string) => navigate(dayRoute(day, today), { replace: true })

  return (
    <div className="daily-log">
      <PeriodHeader
        title={formatDayLong(date, today)}
        relative={relativeDayLabel(date, today)}
        unit="day"
        isCurrent={date === today}
        pickerValue={date}
        onPrev={() => goTo(addDays(date, -1))}
        onNext={() => goTo(addDays(date, 1))}
        onCurrent={() => goTo(today)}
        onPick={(day) => goTo(day)}
      />

      {/* Migration: only where it applies, and only when there is something to move */}
      {date === today && overdue > 0 && (
        <div className="migrate-banner">
          <span>
            {overdue} open {overdue === 1 ? 'task' : 'tasks'} left on earlier days
          </span>
          <button type="button" onClick={() => migrateWithUndo(today).catch(showError)}>
            Move to today
          </button>
        </div>
      )}

      <ul className="entry-list">
        {entries === undefined ? (
          <li className="loading">Loading…</li>
        ) : entries.length === 0 ? (
          <li className="empty">Nothing logged for this day yet.</li>
        ) : (
          entries.map((de) => (
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
          ))
        )}
      </ul>

      <Composer placeholder="New entry…" withKind onAdd={(status, body) => addEntry(date, status, body)} />
    </div>
  )
}
