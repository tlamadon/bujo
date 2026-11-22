import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { isClosed, stripTags, updateEntry, type BujoEntry } from './db'
import { toggleEntryDone } from './entryActions'
import { More } from './Icons'
import { entryIcon } from './statusMeta'
import TagPills from './TagPills'
import { showError } from './toast'

interface Props {
  entry: BujoEntry
  /** Shown between the signifier and the text, e.g. the entry's date in a cross-day list */
  meta?: string
  /** A tag not worth repeating on every row (the one the list is about) */
  hideTag?: string
  onOpenDetail?: (entry: BujoEntry) => void
  onTagClick?: (tagName: string) => void
}

/**
 * The contents of one entry row: signifier (tap: done / not done), text (tap:
 * edit in place), tags, and a button for everything else.
 */
export default function EditableEntry({ entry, meta, hideTag, onOpenDetail, onTagClick }: Props) {
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // Set once the edit is over (saved or abandoned): blur can follow Enter or Escape.
  const done = useRef(false)

  const text = stripTags(entry.body) || entry.body
  const closed = isClosed(entry)

  const startEditing = useCallback(() => {
    done.current = false
    setEditText(entry.body)
    setEditing(true)
  }, [entry.body])

  // Focus the editor with the caret at the end, and size it to its text.
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!editing || !el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [editing])

  useLayoutEffect(() => {
    const el = inputRef.current
    if (!editing || !el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [editing, editText])

  const save = useCallback(async () => {
    setEditing(false)
    if (done.current) return
    done.current = true
    const trimmed = editText.replace(/\s+/g, ' ').trim()
    if (!trimmed || trimmed === entry.body) return
    try {
      await updateEntry(entry, { body: trimmed })
    } catch (err) {
      showError(err)
    }
  }, [editText, entry])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        save()
      } else if (e.key === 'Escape') {
        e.stopPropagation()
        done.current = true
        setEditing(false)
      }
    },
    [save],
  )

  return (
    <>
      <button
        type="button"
        className="signifier"
        onClick={() => toggleEntryDone(entry)}
        aria-label={`${closed ? 'Reopen' : 'Mark done'}: ${text}`}
        title={closed ? 'Reopen' : 'Mark done'}
      >
        <span className="signifier-box" aria-hidden="true">
          {entryIcon(entry)}
        </span>
      </button>
      {meta !== undefined && <span className="entry-meta">{meta}</span>}
      {editing ? (
        <textarea
          ref={inputRef}
          className="body-edit"
          rows={1}
          value={editText}
          aria-label="Entry text"
          enterKeyHint="done"
          onChange={(e) => setEditText(e.target.value)}
          onBlur={save}
          onKeyDown={handleKeyDown}
        />
      ) : (
        <span className="body">
          <span
            className="body-text"
            role="button"
            tabIndex={0}
            title="Edit text"
            onClick={startEditing}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                startEditing()
              }
            }}
          >
            {entry.priority && (
              <span className="priority-marker" title="Priority">
                *
              </span>
            )}
            {entry.status === 'event' && entry.time && <span className="entry-time">{entry.time}</span>}
            {text}
          </span>
          <TagPills tags={hideTag ? entry.tags?.filter((t) => t !== hideTag) : entry.tags} onTagClick={onTagClick} />
        </span>
      )}
      {onOpenDetail && (
        <button
          type="button"
          className="detail-btn"
          onClick={() => onOpenDetail(entry)}
          aria-label={`Details: ${text}`}
          title="Details"
        >
          <More />
        </button>
      )}
    </>
  )
}
