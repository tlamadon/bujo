import { useState, useRef, useCallback } from 'react'
import { updateEntry, type BujoEntry } from './db'

interface Props {
  entry: BujoEntry
  statusIcon: string
  onCycleStatus: (entry: BujoEntry) => void
  onDelete: (entry: BujoEntry) => void
}

export default function EditableEntry({ entry, statusIcon, onCycleStatus, onDelete }: Props) {
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const startEditing = useCallback(() => {
    setEditText(entry.body)
    setEditing(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [entry.body])

  const save = useCallback(async () => {
    const trimmed = editText.trim()
    if (trimmed && trimmed !== entry.body) {
      await updateEntry(entry, { body: trimmed })
    }
    setEditing(false)
  }, [editText, entry])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        save()
      } else if (e.key === 'Escape') {
        setEditing(false)
      }
    },
    [save],
  )

  return (
    <>
      <button
        className="signifier"
        onClick={() => onCycleStatus(entry)}
        title={`Status: ${entry.status} (click to cycle)`}
      >
        {statusIcon}
      </button>
      {editing ? (
        <input
          ref={inputRef}
          className="body-edit"
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onBlur={save}
          onKeyDown={handleKeyDown}
        />
      ) : (
        <span className="body" onClick={startEditing} title="Click to edit">
          {entry.body}
        </span>
      )}
      <button
        className="delete-btn"
        onClick={() => onDelete(entry)}
        aria-label="Delete"
      >
        &times;
      </button>
    </>
  )
}
