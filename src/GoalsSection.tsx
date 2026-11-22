import { useMemo, useState } from 'react'
import { addGoal, type BujoEntry } from './db'
import EditableEntry from './EditableEntry'
import { useEntriesForPeriod } from './hooks'
import { Plus } from './Icons'
import QuickAdd from './QuickAdd'
import { entryClass } from './statusMeta'

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

  return (
    <section className="goals-section">
      <div className="card-header">
        <h3>{title}</h3>
        <button
          type="button"
          className="add-btn"
          onClick={() => setAdding(!adding)}
          aria-label="Add goal"
          aria-expanded={adding}
          title="Add goal"
        >
          <span className="add-btn-box">
            <Plus />
          </span>
        </button>
      </div>

      {adding && (
        <QuickAdd placeholder="New goal…" onAdd={(body) => addGoal(period, body)} onDone={() => setAdding(false)} />
      )}

      {goals === undefined ? (
        <div className="card-empty">…</div>
      ) : goals.length === 0 ? (
        <div className="card-empty">No goals yet.</div>
      ) : (
        <ul className="entry-list compact">
          {goals.map((goal) => (
            <li key={goal._id} className={`entry ${entryClass(goal)}`}>
              <EditableEntry entry={goal} onOpenDetail={onOpenDetail} onTagClick={onTagClick} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
