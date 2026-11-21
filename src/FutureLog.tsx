import { useState, useCallback, useMemo } from 'react'
import {
  addEntry,
  UNSCHEDULED,
  type BujoStatus,
  type BujoEntry,
} from './db'
import { useMonthScheduledEntries, useUnscheduledEntries } from './hooks'
import EditableEntry from './EditableEntry'
import { cycleEntryStatus } from './entryActions'
import { NEW_ENTRY_STATUSES, STATUS_ICONS, STATUS_ORDER, entryClass, entryIcon } from './statusMeta'

function formatMonth(month: string): string {
  const [year, m] = month.split('-').map(Number)
  return new Date(year, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
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

  // Entries scheduled for a month rather than a day, grouped by month
  const rawMonthEntries = useMonthScheduledEntries()
  const byMonth = useMemo(() => {
    const groups = new Map<string, BujoEntry[]>()
    for (const entry of rawMonthEntries ?? []) {
      groups.set(entry.date, [...(groups.get(entry.date) ?? []), entry])
    }
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, list]) => ({
        month,
        entries: list.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.createdAt - b.createdAt),
      }))
  }, [rawMonthEntries])

  const handleAdd = useCallback(async () => {
    const trimmed = newBody.trim()
    if (!trimmed) return
    await addEntry(UNSCHEDULED, newStatus, trimmed)
    setNewBody('')
    setNewStatus('task')
  }, [newBody, newStatus])

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
            <li key={entry._id} className={`entry ${entryClass(entry)}`}>
              <EditableEntry
                entry={entry}
                statusIcon={entryIcon(entry)}
                onCycleStatus={cycleEntryStatus}
                onOpenDetail={onOpenDetail}
                onTagClick={onTagClick}
              />
            </li>
          ))
        )}
      </ul>

      {byMonth.map(({ month, entries: monthEntries }) => (
        <section key={month} className="future-month">
          <h3 className="future-month-title">{formatMonth(month)}</h3>
          <ul className="entry-list">
            {monthEntries.map((entry) => (
              <li key={entry._id} className={`entry ${entryClass(entry)}`}>
                <EditableEntry
                  entry={entry}
                  statusIcon={entryIcon(entry)}
                  onCycleStatus={cycleEntryStatus}
                  onOpenDetail={onOpenDetail}
                  onTagClick={onTagClick}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}

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
          {NEW_ENTRY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_ICONS[s]} {s}
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
