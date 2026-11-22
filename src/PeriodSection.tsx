import { useState } from 'react'
import { addEntry, type BujoEntry } from './db'
import EditableEntry from './EditableEntry'
import { useEntriesForPeriod } from './hooks'
import { Plus } from './Icons'
import QuickAdd from './QuickAdd'
import { compareEntries, entryClass } from './statusMeta'
import { useStableList } from './useStableList'

const entryId = (entry: BujoEntry) => entry._id

interface Props {
  /** ISO week (YYYY-Www) or month (YYYY-MM) */
  period: string
  title: string
  /** What the "+" adds, for its label: "Add a task for the week" */
  addLabel: string
  onOpenDetail?: (entry: BujoEntry) => void
  onTagClick?: (tagName: string) => void
}

/**
 * What belongs to a week or a month as a whole, with no day yet: the larger
 * things to get done in it (often epics, with subtasks spread over its days).
 */
export default function PeriodSection({ period, title, addLabel, onOpenDetail, onTagClick }: Props) {
  const entries = useStableList(useEntriesForPeriod(period), {
    id: entryId,
    compare: compareEntries,
    resetKey: period,
  })
  const [adding, setAdding] = useState(false)

  return (
    <section className="period-section">
      <div className="card-header">
        <h3>{title}</h3>
        <button
          type="button"
          className="add-btn"
          onClick={() => setAdding(!adding)}
          aria-label={addLabel}
          aria-expanded={adding}
          title={addLabel}
        >
          <span className="add-btn-box">
            <Plus />
          </span>
        </button>
      </div>

      {adding && (
        <QuickAdd placeholder="New task…" onAdd={(body) => addEntry(period, 'task', body)} onDone={() => setAdding(false)} />
      )}

      {entries === undefined ? (
        <div className="card-empty">…</div>
      ) : entries.length === 0 ? (
        <div className="card-empty">Nothing yet.</div>
      ) : (
        <ul className="entry-list compact">
          {entries.map((entry) => (
            <li key={entry._id} className={`entry ${entryClass(entry)}`}>
              <EditableEntry entry={entry} onOpenDetail={onOpenDetail} onTagClick={onTagClick} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
