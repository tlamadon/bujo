import { useState, useCallback, useMemo } from 'react'
import {
  addEntry,
  updateEntry,
  stripTags,
  migrateOpenTasks,
  type BujoStatus,
  type BujoEntry,
  type DisplayEntry,
} from './db'
import { useEntriesForDate } from './hooks'
import EditableEntry from './EditableEntry'
import { relativeDayLabel } from './relativeLabel'
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

function sortDisplayEntries(entries: DisplayEntry[]): DisplayEntry[] {
  return [...entries].sort((a, b) => {
    // Ghosts (rescheduled away) always go after completed but before notes
    const orderA = a.isGhost ? 3.5 : STATUS_ORDER[a.entry.status]
    const orderB = b.isGhost ? 3.5 : STATUS_ORDER[b.entry.status]
    if (orderA !== orderB) return orderA - orderB
    return a.entry.createdAt - b.entry.createdAt
  })
}

function formatDailyDate(iso: string): string {
  const d = parseDate(iso)
  const day = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  if (d.getFullYear() !== new Date().getFullYear()) {
    return `${day}, ${d.getFullYear()}`
  }
  return day
}

interface Props {
  initialDate?: string | null
  onOpenDetail?: (entry: BujoEntry) => void
  onTagClick?: (tagName: string) => void
}

export default function DailyLog({ initialDate, onOpenDetail, onTagClick }: Props) {
  const [viewDate, setViewDate] = useState(() => initialDate || toISODate(new Date()))
  const [newBody, setNewBody] = useState('')
  const [newStatus, setNewStatus] = useState<BujoStatus>('task')

  const rawEntries = useEntriesForDate(viewDate)
  const entries = useMemo(() => rawEntries && sortDisplayEntries(rawEntries), [rawEntries])

  const handleAdd = useCallback(async () => {
    const trimmed = newBody.trim()
    if (!trimmed) return
    await addEntry(viewDate, newStatus, trimmed)
    setNewBody('')
    setNewStatus('task')
  }, [viewDate, newBody, newStatus])

  const cycleStatus = useCallback(async (entry: BujoEntry) => {
    const idx = STATUS_CYCLE.indexOf(entry.status)
    const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length]
    await updateEntry(entry, { status: next })
  }, [])

  const handleMigrate = useCallback(async () => {
    const today = toISODate(new Date())
    const count = await migrateOpenTasks(today)
    if (count === 0) {
      alert('No open tasks to migrate.')
    } else {
      alert(`Migrated ${count} task(s) to today.`)
      setViewDate(today)
    }
  }, [])

  const shiftDate = (days: number) => {
    const d = parseDate(viewDate)
    d.setDate(d.getDate() + days)
    setViewDate(toISODate(d))
  }

  return (
    <div className="daily-log">
      {/* Header */}
      <header className="log-header">
        <button onClick={() => shiftDate(-1)} aria-label="Previous day">&larr;</button>
        <h2 className="date-heading">
          <label>
            {formatDailyDate(viewDate)}
            <input
              type="date"
              value={viewDate}
              onChange={(e) => setViewDate(e.target.value)}
              className="date-picker-hidden"
            />
          </label>
        </h2>
        <button onClick={() => shiftDate(1)} aria-label="Next day">&rarr;</button>
      </header>
      <div className="relative-label">
        {relativeDayLabel(viewDate)}
        {viewDate !== toISODate(new Date()) && (
          <button className="now-btn" onClick={() => setViewDate(toISODate(new Date()))}>Now</button>
        )}
      </div>

      {/* Migration action */}
      <button className="migrate-btn" onClick={handleMigrate}>
        Migrate open tasks &rarr; today
      </button>

      {/* Entry list */}
      <ul className="entry-list">
        {entries === undefined ? (
          <li className="loading">Loading…</li>
        ) : entries.length === 0 ? (
          <li className="empty">No entries for this day.</li>
        ) : (
          entries.map((de) => (
            <li
              key={de.isGhost ? `ghost-${de.ghostDoc?._id}` : de.entry._id}
              className={`entry ${de.isGhost ? 'status-scheduled ghost-entry' : `status-${de.entry.status}`}`}
            >
              {de.isGhost ? (
                <button
                  className="ghost-link"
                  onClick={() => setViewDate(de.entry.date)}
                  title={`Rescheduled to ${de.entry.date} — click to go there`}
                >
                  <span className="signifier ghost-signifier">&gt;</span>
                  <span className="body ghost-body">
                    {stripTags(de.entry.body)}
                  </span>
                  <span className="ghost-label">→ {de.entry.date}</span>
                </button>
              ) : (
                <EditableEntry
                  entry={de.entry}
                  statusIcon={STATUS_ICONS[de.entry.status]}
                  onCycleStatus={cycleStatus}
                  onOpenDetail={onOpenDetail}
                  onTagClick={onTagClick}
                />
              )}
            </li>
          ))
        )}
      </ul>

      {/* New entry form */}
      <form
        className="new-entry"
        onSubmit={(e) => {
          e.preventDefault()
          handleAdd()
        }}
      >
        <select
          value={newStatus}
          onChange={(e) => setNewStatus(e.target.value as BujoStatus)}
        >
          {Object.entries(STATUS_ICONS).map(([s, icon]) => (
            <option key={s} value={s}>
              {icon} {s}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="New entry…"
          value={newBody}
          onChange={(e) => setNewBody(e.target.value)}
          autoFocus
        />
        <button type="submit">Add</button>
      </form>
    </div>
  )
}
