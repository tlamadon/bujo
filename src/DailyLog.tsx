import { useState, useCallback, useMemo } from 'react'
import {
  addEntry,
  updateEntry,
  deleteEntry,
  migrateOpenTasks,
  type BujoStatus,
  type BujoEntry,
} from './db'
import { useEntriesForDate } from './hooks'
import EditableEntry from './EditableEntry'

const STATUS_ICONS: Record<BujoStatus, string> = {
  task: '•',
  completed: '✕',
  migrated: '>',
  scheduled: '<',
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

function sortEntries(entries: BujoEntry[]): BujoEntry[] {
  return [...entries].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status])
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

interface Props {
  initialDate?: string | null
}

export default function DailyLog({ initialDate }: Props) {
  const [viewDate, setViewDate] = useState(() => initialDate || toISODate(new Date()))
  const [newBody, setNewBody] = useState('')
  const [newStatus, setNewStatus] = useState<BujoStatus>('task')

  const rawEntries = useEntriesForDate(viewDate)
  const entries = useMemo(() => rawEntries && sortEntries(rawEntries), [rawEntries])

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

  const handleDelete = useCallback(async (entry: BujoEntry) => {
    await deleteEntry(entry)
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
    const d = new Date(viewDate + 'T00:00:00')
    d.setDate(d.getDate() + days)
    setViewDate(toISODate(d))
  }

  return (
    <div className="daily-log">
      {/* Header */}
      <header className="log-header">
        <button onClick={() => shiftDate(-1)} aria-label="Previous day">&larr;</button>
        <h2>
          <input
            type="date"
            value={viewDate}
            onChange={(e) => setViewDate(e.target.value)}
          />
        </h2>
        <button onClick={() => shiftDate(1)} aria-label="Next day">&rarr;</button>
      </header>

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
          entries.map((entry) => (
            <li key={entry._id} className={`entry status-${entry.status}`}>
              <EditableEntry
                entry={entry}
                statusIcon={STATUS_ICONS[entry.status]}
                onCycleStatus={cycleStatus}
                onDelete={handleDelete}
              />
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
