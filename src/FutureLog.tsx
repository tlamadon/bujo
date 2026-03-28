import { useState, useCallback, useMemo } from 'react'
import {
  addEntry,
  updateEntry,
  UNSCHEDULED,
  type BujoStatus,
  type BujoEntry,
} from './db'
import { useUnscheduledEntries } from './hooks'
import EditableEntry from './EditableEntry'

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

interface Props {
  onOpenDetail?: (entry: BujoEntry) => void
  onTagClick?: (tagName: string) => void
}

export default function FutureLog({ onOpenDetail, onTagClick }: Props) {
  const rawEntries = useUnscheduledEntries()
  const [newBody, setNewBody] = useState('')
  const [newStatus, setNewStatus] = useState<BujoStatus>('task')

  const entries = useMemo(() => {
    if (!rawEntries) return undefined
    return [...rawEntries].sort((a, b) => {
      const orderA = STATUS_ORDER[a.status]
      const orderB = STATUS_ORDER[b.status]
      if (orderA !== orderB) return orderA - orderB
      return a.createdAt - b.createdAt
    })
  }, [rawEntries])

  const handleAdd = useCallback(async () => {
    const trimmed = newBody.trim()
    if (!trimmed) return
    await addEntry(UNSCHEDULED, newStatus, trimmed)
    setNewBody('')
    setNewStatus('task')
  }, [newBody, newStatus])

  const cycleStatus = useCallback(async (entry: BujoEntry) => {
    const idx = STATUS_CYCLE.indexOf(entry.status)
    const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length]
    await updateEntry(entry, { status: next })
  }, [])

  return (
    <div className="future-log">
      <h2 className="future-log-title">Future</h2>
      <p className="future-log-desc">Unscheduled tasks — assign a date via the edit panel.</p>

      <ul className="entry-list">
        {entries === undefined ? (
          <li className="loading">Loading…</li>
        ) : entries.length === 0 ? (
          <li className="empty">No unscheduled entries.</li>
        ) : (
          entries.map((entry) => (
            <li key={entry._id} className={`entry status-${entry.status}`}>
              <EditableEntry
                entry={entry}
                statusIcon={STATUS_ICONS[entry.status]}
                onCycleStatus={cycleStatus}
                onOpenDetail={onOpenDetail}
                onTagClick={onTagClick}
              />
            </li>
          ))
        )}
      </ul>

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
          placeholder="New unscheduled entry…"
          value={newBody}
          onChange={(e) => setNewBody(e.target.value)}
          autoFocus
        />
        <button type="submit">Add</button>
      </form>
    </div>
  )
}
