import { useState, useCallback, useMemo } from 'react'
import { addGoal, type BujoEntry } from './db'
import { useEntriesForPeriod } from './hooks'
import EditableEntry from './EditableEntry'
import { cycleEntryStatus } from './entryActions'
import { entryClass, entryIcon } from './statusMeta'

interface Props {
  /** ISO week (YYYY-Www) or month (YYYY-MM) the goals belong to */
  period: string
  title: string
  onOpenDetail?: (entry: BujoEntry) => void
  onTagClick?: (tagName: string) => void
}

export default function GoalsSection({ period, title, onOpenDetail, onTagClick }: Props) {
  const periodEntries = useEntriesForPeriod(period)
  const goals = useMemo(() => periodEntries?.filter((e) => e.status === 'goal'), [periodEntries])
  const [adding, setAdding] = useState(false)
  const [newBody, setNewBody] = useState('')

  const handleAdd = useCallback(async () => {
    const trimmed = newBody.trim()
    if (!trimmed) return
    await addGoal(period, trimmed)
    setNewBody('')
    setAdding(false)
  }, [newBody, period])

  return (
    <section className="goals-section">
      <div className="goals-header">
        <h3>{title}</h3>
        <button
          className="week-add-btn"
          onClick={() => {
            setAdding(!adding)
            setNewBody('')
          }}
          aria-label="Add goal"
        >
          +
        </button>
      </div>

      {adding && (
        <form
          className="week-quick-add"
          onSubmit={(e) => {
            e.preventDefault()
            handleAdd()
          }}
        >
          <input
            type="text"
            placeholder="New goal…"
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
            autoFocus
          />
          <button type="submit">Add</button>
        </form>
      )}

      {goals === undefined ? (
        <div className="loading">…</div>
      ) : goals.length === 0 ? (
        <div className="goals-empty">No goals yet.</div>
      ) : (
        <ul className="entry-list goals-list">
          {goals.map((goal) => (
            <li key={goal._id} className={`entry ${entryClass(goal)}`}>
              <EditableEntry
                entry={goal}
                statusIcon={entryIcon(goal)}
                onCycleStatus={cycleEntryStatus}
                onOpenDetail={onOpenDetail}
                onTagClick={onTagClick}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
