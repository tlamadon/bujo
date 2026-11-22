import { useEffect, useRef, useState } from 'react'
import type { BujoStatus } from './db'
import { NEW_ENTRY_STATUSES, STATUS_ICONS } from './statusMeta'
import { showError } from './toast'

interface Props {
  placeholder: string
  /** Offer a choice of task / event / note. Without it every entry is a task. */
  withKind?: boolean
  onAdd: (status: BujoStatus, body: string) => Promise<unknown>
}

/**
 * The "new entry" form at the foot of a list. It sticks to the bottom of the
 * screen so adding never means scrolling past a long day first.
 */
export default function Composer({ placeholder, withKind = false, onAdd }: Props) {
  const [body, setBody] = useState('')
  const [status, setStatus] = useState<BujoStatus>('task')
  const inputRef = useRef<HTMLInputElement>(null)

  // Ready to type on a computer. Not on touch screens, where focusing would
  // throw the keyboard over the page every time a view opens.
  useEffect(() => {
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      inputRef.current?.focus({ preventScroll: true })
    }
  }, [])

  const submit = async () => {
    const trimmed = body.trim()
    if (!trimmed) return
    try {
      await onAdd(status, trimmed)
      setBody('')
      setStatus('task')
    } catch (err) {
      showError(err)
    }
  }

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      {withKind && (
        <select value={status} onChange={(e) => setStatus(e.target.value as BujoStatus)} aria-label="Kind of entry">
          {NEW_ENTRY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_ICONS[s]} {s}
            </option>
          ))}
        </select>
      )}
      <input
        ref={inputRef}
        type="text"
        placeholder={placeholder}
        aria-label={placeholder}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        enterKeyHint="done"
        autoComplete="off"
        data-composer
      />
      <button type="submit" disabled={!body.trim()}>
        Add
      </button>
    </form>
  )
}
