import { useEffect, useMemo, useRef, useState } from 'react'
import {
  addDays,
  addEntry,
  addMonths,
  addWeeks,
  idTail,
  isScheduledDate,
  isTaskLike,
  isoWeekKey,
  monthKey,
  parseTags,
  refOf,
  setParent,
  stripTags,
  updateEntry,
  type BujoEntry,
  type BujoStatus,
  type EntryChanges,
} from './db'
import { deleteWithUndo, rescheduleWithUndo, toggleEntryDone } from './entryActions'
import { formatDateCompact, formatDateValue, formatTimestamp } from './format'
import { useAllEntries } from './hooks'
import { Bolt, Close } from './Icons'
import QuickAdd from './QuickAdd'
import { STATUS_ICONS, entryClass, entryIcon } from './statusMeta'
import TagPills from './TagPills'

const SELECTABLE_STATUSES: BujoStatus[] = ['task', 'completed', 'dropped', 'note', 'event']

/** How many tasks the "Part of" list offers before it stops being a list one can read */
const MAX_PARENT_CHOICES = 60

const textOf = (entry: BujoEntry) => stripTags(entry.body) || entry.body

interface Props {
  entry: BujoEntry
  today: string
  onClose: () => void
  /** Show another entry in the panel instead (a subtask, or the epic above) */
  onOpenEntry: (entry: BujoEntry) => void
}

/**
 * Everything about one entry, in a modal dialog: a sheet rising from the
 * bottom on a phone, a panel on the right on a wide screen. A native
 * <dialog> brings the focus trap, Escape and the inert page behind for free.
 */
export default function TaskDetail({ entry, today, onClose, onOpenEntry }: Props) {
  const [body, setBody] = useState(entry.body)
  const [status, setStatus] = useState(entry.status)
  const [priority, setPriority] = useState(!!entry.priority)
  const [time, setTime] = useState(entry.time ?? '')
  const [parentTail, setParentTail] = useState(entry.parent ?? '')
  const [rescheduleDate, setRescheduleDate] = useState('')
  const [showReschedule, setShowReschedule] = useState(false)
  const [addingSubtask, setAddingSubtask] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dialogRef = useRef<HTMLDialogElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const pressedBackdrop = useRef(false)

  // Subtasks and the epic above live on other days: look across the journal.
  const allEntries = useAllEntries()
  const tail = idTail(entry._id)
  const subtasks = useMemo(
    () => (allEntries ?? []).filter((e) => e.parent === tail).sort((a, b) => a.createdAt - b.createdAt),
    [allEntries, tail],
  )
  const parent = useMemo(
    () => allEntries?.find((e) => idTail(e._id) === entry.parent),
    [allEntries, entry.parent],
  )
  // What this entry could be a subtask of: tasks that are not subtasks
  // themselves. Epics first, then the most recent.
  const parentChoices = useMemo(() => {
    const isEpic = new Set((allEntries ?? []).map((e) => e.parent).filter(Boolean))
    return (allEntries ?? [])
      .filter((e) => isTaskLike(e) && !e.parent && idTail(e._id) !== tail)
      .filter((e) => e.status === 'task' || idTail(e._id) === entry.parent)
      .sort((a, b) => Number(isEpic.has(idTail(b._id))) - Number(isEpic.has(idTail(a._id))) || b.createdAt - a.createdAt)
      .slice(0, MAX_PARENT_CHOICES)
  }, [allEntries, tail, entry.parent])

  // One level only: an epic cannot become a subtask, a subtask cannot hold any.
  const canHaveParent = subtasks.length === 0
  const canHaveSubtasks = isTaskLike(entry) && !entry.parent && !parentTail

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
    // A time only means something on an event
    if (status === 'event' && time !== (entry.time ?? '')) changes.time = time || null
    return act(async () => {
      let current = entry
      if (Object.keys(changes).length > 0) current = await updateEntry(current, changes)
      if (parentTail !== (entry.parent ?? '')) {
        const next = parentChoices.find((e) => idTail(e._id) === parentTail) ?? null
        await setParent(current, next)
      }
    })
  }

  const reschedule = (date: string) => {
    if (date) act(() => rescheduleWithUndo(entry, date))
  }

  const scheduled = isScheduledDate(entry.date)
  const dateHistory = entry.dateHistory || []
  const tags = parseTags(body)
  const done = subtasks.filter((e) => e.status === 'completed').length
  const countable = done + subtasks.filter((e) => e.status === 'task').length

  // Where the entry can go in one tap: a day, or a week or month as a whole
  const quickDates: [label: string, date: string][] = [
    ['Today', today],
    ['Tomorrow', addDays(today, 1)],
    ['This week', isoWeekKey(today)],
    ['Next week', addWeeks(isoWeekKey(today), 1)],
    ['This month', monthKey(today)],
    ['Next month', addMonths(monthKey(today), 1)],
  ]

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
          <h2 id="task-detail-title">
            {subtasks.length > 0 ? (
              <>
                <span className="epic-badge">
                  <Bolt />
                </span>{' '}
                Epic
              </>
            ) : (
              'Entry'
            )}
          </h2>
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
            Kind
          </span>
          <div className="choice-group" role="group" aria-labelledby="task-detail-status">
            {SELECTABLE_STATUSES.map((s) => (
              <button key={s} type="button" className="choice" aria-pressed={s === status} onClick={() => setStatus(s)}>
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
          <span className="field-label">When</span>
          <div className="task-detail-when">
            <span>{formatDateValue(entry.date)}</span>
            <button
              type="button"
              className="btn"
              aria-expanded={showReschedule}
              onClick={() => {
                setShowReschedule(!showReschedule)
                if (!rescheduleDate) setRescheduleDate(addDays(today, 1))
              }}
            >
              {scheduled ? 'Reschedule' : 'Schedule'}
            </button>
          </div>

          {showReschedule && (
            <div className="task-detail-reschedule">
              <div className="choice-group">
                {quickDates
                  .filter(([, date]) => date !== entry.date)
                  .map(([label, date]) => (
                    <button key={label} type="button" className="choice" onClick={() => reschedule(date)}>
                      {label}
                    </button>
                  ))}
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
                A week or a month means “some time in it”, with no day yet. Moving off a day leaves a “&gt;” marker
                there.
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

        {canHaveParent && (parentChoices.length > 0 || parent) && (
          <label className="field">
            <span className="field-label">Part of</span>
            <span className="task-detail-parent">
              <select value={parentTail} onChange={(e) => setParentTail(e.target.value)}>
                <option value="">Nothing — a task of its own</option>
                {parentChoices.map((choice) => (
                  <option key={choice._id} value={idTail(choice._id)}>
                    {textOf(choice)} · {formatDateCompact(choice.date)}
                  </option>
                ))}
              </select>
              {parent && parentTail === entry.parent && (
                <button type="button" className="btn" onClick={() => onOpenEntry(parent)}>
                  Open
                </button>
              )}
            </span>
          </label>
        )}

        {canHaveSubtasks && (
          <div className="field">
            <span className="field-label">
              Subtasks{subtasks.length > 0 && countable > 0 ? ` · ${done} of ${countable} done` : ''}
            </span>
            {subtasks.length > 0 && (
              <ul className="entry-list compact subtask-list">
                {subtasks.map((sub) => (
                  <li key={sub._id} className={`entry ${entryClass(sub)}`}>
                    <button
                      type="button"
                      className="signifier"
                      onClick={() => toggleEntryDone(sub)}
                      aria-label={`${sub.status === 'completed' || sub.status === 'dropped' ? 'Reopen' : 'Mark done'}: ${textOf(sub)}`}
                    >
                      <span className="signifier-box" aria-hidden="true">
                        {entryIcon(sub)}
                      </span>
                    </button>
                    <span className="entry-meta">{formatDateCompact(sub.date)}</span>
                    <span className="body">
                      <button type="button" className="subtask-open body-text" onClick={() => onOpenEntry(sub)}>
                        {textOf(sub)}
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {addingSubtask ? (
              <QuickAdd
                placeholder="New subtask…"
                // It starts where the epic is; give it its own day from its panel
                onAdd={(text) => addEntry(entry.date, 'task', text, { parent: entry })}
                onDone={() => setAddingSubtask(false)}
              />
            ) : (
              <button type="button" className="btn" onClick={() => setAddingSubtask(true)}>
                Add a subtask
              </button>
            )}
          </div>
        )}

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
