import { useState, useCallback, useMemo } from 'react'
import {
  addEntry,
  updateEntry,

  type BujoStatus,
  type BujoEntry,
  type DisplayEntry,
} from './db'
import { useEntriesForDateRange } from './hooks'
import EditableEntry from './EditableEntry'
import { relativeWeekLabel } from './relativeLabel'
import { toISODate, parseDate } from './dateUtils'

const STATUS_ICONS: Record<BujoStatus, string> = {
  task: '•',
  completed: '✕',
  migrated: '>',
  scheduled: '>',
  note: '–',
  event: '○',
}

const STATUS_CYCLE: BujoStatus[] = ['task', 'completed', 'note', 'event']

const STATUS_ORDER: Record<BujoStatus, number> = {
  task: 0,
  migrated: 1,
  scheduled: 2,
  completed: 3,
  note: 4,
  event: 5,
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Get the Monday of the week containing `date` */
function getMonday(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff)
  return d
}

function getWeekDates(monday: Date): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return toISODate(d)
  })
}

function formatShortDate(iso: string): string {
  const d = parseDate(iso)
  return `${d.getDate()}/${d.getMonth() + 1}`
}

interface Props {
  onNavigateToDay: (date: string) => void
  onOpenDetail?: (entry: BujoEntry) => void
}

export default function WeeklyLog({ onNavigateToDay, onOpenDetail }: Props) {
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()))

  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart])
  const rawEntries = useEntriesForDateRange(weekDates[0], weekDates[6])

  // Group display entries by the date they appear on
  const byDate = useMemo(() => {
    const map: Record<string, DisplayEntry[]> = {}
    for (const d of weekDates) map[d] = []
    if (rawEntries) {
      for (const de of rawEntries) {
        // For ghosts, the ghost's date field tells us which day it appears on
        const displayDate = de.isGhost ? de.ghostDoc!.date : de.entry.date
        if (map[displayDate]) map[displayDate].push(de)
      }
    }
    return map
  }, [rawEntries, weekDates])

  const shiftWeek = (dir: number) => {
    setWeekStart((prev) => {
      const d = new Date(prev)
      d.setDate(d.getDate() + dir * 7)
      return d
    })
  }

  const cycleStatus = useCallback(async (entry: BujoEntry) => {
    const idx = STATUS_CYCLE.indexOf(entry.status)
    const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length]
    await updateEntry(entry, { status: next })
  }, [])

  // Quick-add state per day
  const [addingDay, setAddingDay] = useState<string | null>(null)
  const [newBody, setNewBody] = useState('')

  const handleQuickAdd = useCallback(
    async (date: string) => {
      const trimmed = newBody.trim()
      if (!trimmed) return
      await addEntry(date, 'task', trimmed)
      setNewBody('')
      setAddingDay(null)
    },
    [newBody],
  )

  // Week label
  const weekEnd = weekDates[6]
  const weekLabel = `${formatShortDate(weekDates[0])} – ${formatShortDate(weekEnd)}`

  return (
    <div className="weekly-log">
      <header className="log-header">
        <button onClick={() => shiftWeek(-1)} aria-label="Previous week">
          &larr;
        </button>
        <h2>Week: {weekLabel}</h2>
        <button onClick={() => shiftWeek(1)} aria-label="Next week">
          &rarr;
        </button>
      </header>
      <div className="relative-label">
        {relativeWeekLabel(weekStart)}
        {relativeWeekLabel(weekStart) !== 'this week' && (
          <button className="now-btn" onClick={() => setWeekStart(getMonday(new Date()))}>Now</button>
        )}
      </div>

      <div className="week-grid">
        {weekDates.map((date, i) => {
          const dayEntries = (byDate[date] || []).slice().sort((a, b) => {
            const orderA = a.isGhost ? 3.5 : STATUS_ORDER[a.entry.status]
            const orderB = b.isGhost ? 3.5 : STATUS_ORDER[b.entry.status]
            if (orderA !== orderB) return orderA - orderB
            return a.entry.createdAt - b.entry.createdAt
          })
          const isToday = date === toISODate(new Date())
          return (
            <div key={date} className={`week-day ${isToday ? 'today' : ''}`}>
              <div className="week-day-header">
                <button
                  className="week-day-label"
                  onClick={() => onNavigateToDay(date)}
                  title="Open daily view"
                >
                  <strong>{DAY_NAMES[i]}</strong>{' '}
                  <span className="week-day-date">{formatShortDate(date)}</span>
                </button>
                <button
                  className="week-add-btn"
                  onClick={() => {
                    setAddingDay(addingDay === date ? null : date)
                    setNewBody('')
                  }}
                  aria-label="Add entry"
                >
                  +
                </button>
              </div>

              {addingDay === date && (
                <form
                  className="week-quick-add"
                  onSubmit={(e) => {
                    e.preventDefault()
                    handleQuickAdd(date)
                  }}
                >
                  <input
                    type="text"
                    placeholder="New task…"
                    value={newBody}
                    onChange={(e) => setNewBody(e.target.value)}
                    autoFocus
                  />
                  <button type="submit">Add</button>
                </form>
              )}

              {rawEntries === undefined ? (
                <div className="loading">…</div>
              ) : dayEntries.length === 0 ? (
                <div className="week-empty">—</div>
              ) : (
                <ul className="week-entries">
                  {dayEntries.map((de) => (
                    <li
                      key={de.isGhost ? `ghost-${de.ghostDoc?._id}` : de.entry._id}
                      className={`week-entry ${de.isGhost ? 'status-scheduled ghost-entry' : `status-${de.entry.status}`}`}
                    >
                      {de.isGhost ? (
                        <button
                          className="ghost-link"
                          onClick={() => setWeekStart(getMonday(parseDate(de.entry.date)))}
                          title={`Rescheduled to ${de.entry.date} — click to go there`}
                        >
                          <span className="signifier ghost-signifier">&gt;</span>
                          <span className="body ghost-body">
                            {de.entry.body}
                          </span>
                          <span className="ghost-label">→ {de.entry.date}</span>
                        </button>
                      ) : (
                        <EditableEntry
                          entry={de.entry}
                          statusIcon={STATUS_ICONS[de.entry.status]}
                          onCycleStatus={cycleStatus}

                          onOpenDetail={onOpenDetail}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
