import { useMemo } from 'react'
import { addEntry, UNSCHEDULED, type BujoEntry } from './db'
import Composer from './Composer'
import EditableEntry from './EditableEntry'
import { formatMonth } from './format'
import { useMonthScheduledEntries, useUnscheduledEntries } from './hooks'
import { compareEntries, entryClass } from './statusMeta'
import { useStableList } from './useStableList'

const entryId = (entry: BujoEntry) => entry._id
const notGoal = (entry: BujoEntry) => entry.status !== 'goal'
const compareByMonth = (a: BujoEntry, b: BujoEntry) => a.date.localeCompare(b.date) || compareEntries(a, b)

interface Props {
  onOpenDetail?: (entry: BujoEntry) => void
  onTagClick?: (tagName: string) => void
}

export default function FutureLog({ onOpenDetail, onTagClick }: Props) {
  const entries = useStableList(useUnscheduledEntries(), {
    id: entryId,
    compare: compareEntries,
    include: notGoal,
    resetKey: 'unscheduled',
  })

  // Entries scheduled for a month rather than a day, grouped by month
  const monthEntries = useStableList(useMonthScheduledEntries(), {
    id: entryId,
    compare: compareByMonth,
    resetKey: 'months',
  })
  const byMonth = useMemo(() => {
    const groups = new Map<string, BujoEntry[]>()
    for (const entry of monthEntries ?? []) {
      groups.set(entry.date, [...(groups.get(entry.date) ?? []), entry])
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [monthEntries])

  const renderList = (list: BujoEntry[]) => (
    <ul className="entry-list">
      {list.map((entry) => (
        <li key={entry._id} className={`entry ${entryClass(entry)}`}>
          <EditableEntry entry={entry} onOpenDetail={onOpenDetail} onTagClick={onTagClick} />
        </li>
      ))}
    </ul>
  )

  return (
    <div className="future-log">
      <header className="view-header">
        <h2>Future</h2>
        <p>Not on a day yet. Open an entry's details to schedule it.</p>
      </header>

      <section className="future-group">
        <h3>Someday</h3>
        {entries === undefined ? (
          <p className="loading">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="empty">Nothing unscheduled.</p>
        ) : (
          renderList(entries)
        )}
      </section>

      {byMonth.map(([month, list]) => (
        <section key={month} className="future-group">
          <h3>{formatMonth(month)}</h3>
          {renderList(list)}
        </section>
      ))}

      <Composer
        placeholder="New unscheduled entry…"
        withKind
        onAdd={(status, body) => addEntry(UNSCHEDULED, status, body)}
      />
    </div>
  )
}
