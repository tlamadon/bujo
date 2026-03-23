import { useState, useCallback } from 'react'
import { db, migrateOpenTasks, type BujoStatus } from './db'
import { useEntriesForDate } from './hooks'

const STATUS_ICONS: Record<BujoStatus, string> = {
  task: '•',
  completed: '✕',
  migrated: '>',
  scheduled: '<',
  note: '–',
  event: '○',
}

const STATUS_CYCLE: BujoStatus[] = ['task', 'completed', 'note', 'event']

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export default function DailyLog() {
  const [viewDate, setViewDate] = useState(() => toISODate(new Date()))
  const [newBody, setNewBody] = useState('')
  const [newStatus, setNewStatus] = useState<BujoStatus>('task')

  const entries = useEntriesForDate(viewDate)

  const addEntry = useCallback(async () => {
    const trimmed = newBody.trim()
    if (!trimmed) return
    await db.entries.add({
      date: viewDate,
      status: newStatus,
      body: trimmed,
      createdAt: Date.now(),
    })
    setNewBody('')
    setNewStatus('task')
  }, [viewDate, newBody, newStatus])

  const cycleStatus = useCallback(async (id: number, current: BujoStatus) => {
    const idx = STATUS_CYCLE.indexOf(current)
    const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length]
    await db.entries.update(id, { status: next })
  }, [])

  const deleteEntry = useCallback(async (id: number) => {
    await db.entries.delete(id)
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
            <li key={entry.id} className={`entry status-${entry.status}`}>
              <button
                className="signifier"
                onClick={() => cycleStatus(entry.id!, entry.status)}
                title={`Status: ${entry.status} (click to cycle)`}
              >
                {STATUS_ICONS[entry.status]}
              </button>
              <span className="body">{entry.body}</span>
              <button
                className="delete-btn"
                onClick={() => deleteEntry(entry.id!)}
                aria-label="Delete"
              >
                &times;
              </button>
            </li>
          ))
        )}
      </ul>

      {/* New entry form */}
      <form
        className="new-entry"
        onSubmit={(e) => {
          e.preventDefault()
          addEntry()
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
