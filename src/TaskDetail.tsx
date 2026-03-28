import { useState, useCallback } from 'react'
import {
  updateEntry,
  deleteEntry,
  rescheduleEntry,
  parseTags,
  isScheduledDate,
  type BujoEntry,
  type BujoStatus,
} from './db'
import { toISODate } from './dateUtils'
import TagPills from './TagPills'

const STATUS_ICONS: Record<BujoStatus, string> = {
  task: '•',
  completed: '✕',
  migrated: '>',
  scheduled: '>',
  note: '–',
  event: '○',
}

const SELECTABLE_STATUSES: BujoStatus[] = ['task', 'completed', 'note', 'event']


interface Props {
  entry: BujoEntry
  onClose: () => void
}

export default function TaskDetail({ entry, onClose }: Props) {
  const [body, setBody] = useState(entry.body)
  const [status, setStatus] = useState(entry.status)
  const [rescheduleDate, setRescheduleDate] = useState('')
  const [showReschedule, setShowReschedule] = useState(false)

  const handleSave = useCallback(async () => {
    const trimmed = body.trim()
    if (!trimmed) return
    const changes: Partial<Pick<BujoEntry, 'status' | 'body'>> = {}
    if (trimmed !== entry.body) changes.body = trimmed
    if (status !== entry.status) changes.status = status
    if (Object.keys(changes).length > 0) {
      await updateEntry(entry, changes)
    }
    onClose()
  }, [body, status, entry, onClose])


  const handleReschedule = useCallback(async () => {
    if (!rescheduleDate) return
    await rescheduleEntry(entry, rescheduleDate)
    onClose()
  }, [rescheduleDate, entry, onClose])

  const handleDelete = useCallback(async () => {
    await deleteEntry(entry)
    onClose()
  }, [entry, onClose])

  const createdDate = new Date(entry.createdAt)
  const dateHistory = entry.dateHistory || []

  return (
    <div className="task-detail-overlay" onClick={onClose}>
      <div className="task-detail" onClick={(e) => e.stopPropagation()}>
        <header className="task-detail-header">
          <h2>Edit Entry</h2>
          <button className="task-detail-close" onClick={onClose}>
            &times;
          </button>
        </header>

        <div className="task-detail-meta">
          <span className="task-detail-date">Date: {isScheduledDate(entry.date) ? entry.date : 'Unscheduled'}</span>
          <span className="task-detail-created">
            Created: {createdDate.toLocaleDateString()} {createdDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>

        {dateHistory.length > 0 && (
          <div className="task-detail-history">
            <label>Schedule history:</label>
            <ul className="task-detail-history-list">
              {dateHistory.map((d, i) => (
                <li key={i}>
                  <span className="ghost-signifier">&gt;</span> {isScheduledDate(d) ? d : 'Unscheduled'}
                </li>
              ))}
              <li className="task-detail-history-current">
                <span className="signifier-static">•</span> {isScheduledDate(entry.date) ? entry.date : 'Unscheduled'} <em>(current)</em>
              </li>
            </ul>
          </div>
        )}

        <div className="task-detail-status">
          <label>Status:</label>
          <div className="task-detail-status-options">
            {SELECTABLE_STATUSES.map((s) => (
              <button
                key={s}
                className={`task-detail-status-option ${s === status ? 'active' : ''}`}
                onClick={() => setStatus(s)}
              >
                <span className="signifier-static">{STATUS_ICONS[s]}</span>
                {s}
              </button>
            ))}
          </div>
        </div>

        <textarea
          className="task-detail-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          autoFocus
        />

        {parseTags(body).length > 0 && (
          <div className="task-detail-tags">
            <label>Tags:</label>
            <TagPills tags={parseTags(body)} />
          </div>
        )}

        <div className="task-detail-actions">
          <button className="task-detail-save" onClick={handleSave}>
            Save
          </button>
          <button
            className="task-detail-reschedule-toggle"
            onClick={() => {
              setShowReschedule(!showReschedule)
              if (!rescheduleDate) {
                const tomorrow = new Date()
                tomorrow.setDate(tomorrow.getDate() + 1)
                setRescheduleDate(toISODate(tomorrow))
              }
            }}
          >
            {isScheduledDate(entry.date) ? 'Reschedule' : 'Schedule'}
          </button>
          <button className="task-detail-delete" onClick={handleDelete}>
            Delete
          </button>
        </div>

        {showReschedule && (
          <div className="task-detail-reschedule">
            <label>Move to:</label>
            <input
              type="date"
              value={rescheduleDate}
              onChange={(e) => setRescheduleDate(e.target.value)}
            />
            <button className="task-detail-reschedule-confirm" onClick={handleReschedule}>
              Confirm
            </button>
            <p className="task-detail-reschedule-hint">
              {isScheduledDate(entry.date)
                ? 'This will leave a "\u003e" marker on the current date and move the task to the selected date.'
                : 'This will assign a date to this unscheduled task.'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
