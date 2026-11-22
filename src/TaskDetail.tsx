import { useEffect, useRef, useState } from 'react'
import {
  addDays,
  isScheduledDate,
  parseTags,
  refOf,
  updateEntry,
  type BujoEntry,
  type BujoStatus,
  type EntryChanges,
  type GoalState,
} from './db'
import { deleteWithUndo, rescheduleWithUndo } from './entryActions'
import { formatDateValue, formatTimestamp } from './format'
import { Close } from './Icons'
import { STATUS_ICONS } from './statusMeta'
import TagPills from './TagPills'

const SELECTABLE_STATUSES: BujoStatus[] = ['task', 'completed', 'dropped', 'note', 'event']

const GOAL_STATES: { value: GoalState | null; icon: string; label: string }[] = [
  { value: null, icon: '◇', label: 'open' },
  { value: 'achieved', icon: '◆', label: 'achieved' },
  { value: 'dropped', icon: '◇', label: 'dropped' },
]

interface Props {
  entry: BujoEntry
  today: string
  onClose: () => void
}

/**
 * Everything about one entry, in a modal dialog: a sheet rising from the
 * bottom on a phone, a panel on the right on a wide screen. A native
 * <dialog> brings the focus trap, Escape and the inert page behind for free.
 */
export default function TaskDetail({ entry, today, onClose }: Props) {
  const isGoal = entry.status === 'goal'
  const [body, setBody] = useState(entry.body)
  const [status, setStatus] = useState(entry.status)
  const [goalState, setGoalState] = useState<GoalState | null>(entry.goalState ?? null)
  const [priority, setPriority] = useState(!!entry.priority)
  const [time, setTime] = useState(entry.time ?? '')
  const [rescheduleDate, setRescheduleDate] = useState('')
  const [showReschedule, setShowReschedule] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dialogRef = useRef<HTMLDialogElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const pressedBackdrop = useRef(false)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog || dialog.open) return
    dialog.showModal()
    // Straight to typing on a computer; on a touch screen that would cover
    // half the sheet with the keyboard before the user has even read it.
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) bodyRef.current?.focus()
    else dialog.focus()
  }, [])

  /** Run an action; close on success, say why on failure. */
  const act = async (action: () => Promise<unknown>) => {
    try {
      await action()
      onClose()
    } catch (err) {
      // Shown in the panel: a toast would sit underneath it.
      setError(err instanceof Error && err.message ? err.message : 'Something went wrong')
    }
  }

  const handleSave = () => {
    const trimmed = body.replace(/\s+/g, ' ').trim()
    if (!trimmed) return
    const changes: EntryChanges = {}
    if (trimmed !== entry.body) changes.body = trimmed
    if (status !== entry.status) changes.status = status
    if (priority !== !!entry.priority) changes.priority = priority
    if (isGoal && goalState !== (entry.goalState ?? null)) changes.goalState = goalState
    // A time only means something on an event
    if (status === 'event' && time !== (entry.time ?? '')) changes.time = time || null
    return act(async () => {
      if (Object.keys(changes).length > 0) await updateEntry(entry, changes)
    })
  }

  const reschedule = (date: string) => {
    if (date) act(() => rescheduleWithUndo(entry, date))
  }

  const scheduled = isScheduledDate(entry.date)
  const dateHistory = entry.dateHistory || []
  const tags = parseTags(body)
  const tomorrow = addDays(today, 1)

  return (
    <dialog
      ref={dialogRef}
      className="sheet"
      aria-labelledby="task-detail-title"
      tabIndex={-1}
      onClose={onClose}
      // A press that lands on the dialog element itself is on the backdrop.
      // It must also start there: a text selection dragged out of the sheet
      // ends on the backdrop too, and should not throw the edit away.
      onPointerDown={(e) => {
        pressedBackdrop.current = e.target === e.currentTarget
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && pressedBackdrop.current) onClose()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          handleSave()
        }
      }}
    >
      <div className="sheet-content">
        <header className="sheet-header">
          <h2 id="task-detail-title">{isGoal ? 'Goal' : 'Entry'}</h2>
          <button type="button" className="icon-btn icon-btn-plain" onClick={onClose} aria-label="Close" title="Close (Esc)">
            <Close />
          </button>
        </header>

        <label className="field">
          <span className="field-label">Text</span>
          <textarea
            ref={bodyRef}
            className="task-detail-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
          />
        </label>

        {tags.length > 0 && (
          <div className="task-detail-tags">
            <TagPills tags={tags} />
          </div>
        )}

        <div className="field">
          <span className="field-label" id="task-detail-status">
            {isGoal ? 'Outcome' : 'Kind'}
          </span>
          <div className="choice-group" role="group" aria-labelledby="task-detail-status">
            {isGoal
              ? GOAL_STATES.map((g) => (
                  <button
                    key={g.label}
                    type="button"
                    className="choice"
                    aria-pressed={g.value === goalState}
                    onClick={() => setGoalState(g.value)}
                  >
                    <span aria-hidden="true">{g.icon}</span> {g.label}
                  </button>
                ))
              : SELECTABLE_STATUSES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="choice"
                    aria-pressed={s === status}
                    onClick={() => setStatus(s)}
                  >
                    <span aria-hidden="true">{STATUS_ICONS[s]}</span> {s}
                  </button>
                ))}
          </div>
        </div>

        <div className="task-detail-flags">
          <label className="check">
            <input type="checkbox" checked={priority} onChange={(e) => setPriority(e.target.checked)} />
            <span>
              <span className="priority-marker">*</span> Priority
            </span>
          </label>
          {status === 'event' && (
            <label className="task-detail-time">
              <span>Time</span>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
          )}
        </div>

        <div className="field">
          <span className="field-label">{isGoal ? 'Period' : 'When'}</span>
          <div className="task-detail-when">
            <span>{formatDateValue(entry.date)}</span>
            {/* Goals belong to a week or month; the day picker cannot move them */}
            {!isGoal && (
              <button
                type="button"
                className="btn"
                aria-expanded={showReschedule}
                onClick={() => {
                  setShowReschedule(!showReschedule)
                  if (!rescheduleDate) setRescheduleDate(tomorrow)
                }}
              >
                {scheduled ? 'Reschedule' : 'Schedule'}
              </button>
            )}
          </div>

          {showReschedule && (
            <div className="task-detail-reschedule">
              <div className="choice-group">
                {entry.date !== today && (
                  <button type="button" className="choice" onClick={() => reschedule(today)}>
                    Today
                  </button>
                )}
                {entry.date !== tomorrow && (
                  <button type="button" className="choice" onClick={() => reschedule(tomorrow)}>
                    Tomorrow
                  </button>
                )}
              </div>
              <div className="task-detail-reschedule-pick">
                <input
                  type="date"
                  value={rescheduleDate}
                  onChange={(e) => setRescheduleDate(e.target.value)}
                  aria-label="Move to date"
                />
                <button type="button" className="btn btn-primary" onClick={() => reschedule(rescheduleDate)}>
                  Move
                </button>
              </div>
              <p className="hint">
                {scheduled
                  ? 'Leaves a ">" marker on the day it was on.'
                  : 'Puts this entry on a day.'}
              </p>
            </div>
          )}

          {dateHistory.length > 0 && (
            <ul className="task-detail-history" aria-label="Schedule history">
              {dateHistory.map((d, i) => (
                <li key={i}>
                  <span aria-hidden="true">&gt;</span> {formatDateValue(d)}
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <div className="sheet-actions">
          <button type="button" className="btn btn-success" onClick={handleSave} disabled={!body.trim()}>
            Save
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger" onClick={() => act(() => deleteWithUndo(entry))}>
            Delete
          </button>
        </div>

        <p className="task-detail-meta">
          Created {formatTimestamp(entry.createdAt)} · Ref{' '}
          <code title="Reference for the bujo CLI">{refOf(entry._id)}</code>
        </p>
      </div>
    </dialog>
  )
}
