import { useState } from 'react'
import { showError } from './toast'

interface Props {
  placeholder: string
  onAdd: (body: string) => Promise<unknown>
  /** Called after an entry was added, or when the user backs out with Escape */
  onDone: () => void
}

/** A one-line form opened by a "+" button: type, Enter, done. */
export default function QuickAdd({ placeholder, onAdd, onDone }: Props) {
  const [body, setBody] = useState('')

  const submit = async () => {
    const trimmed = body.trim()
    if (!trimmed) return
    try {
      await onAdd(trimmed)
      onDone()
    } catch (err) {
      showError(err)
    }
  }

  return (
    <form
      className="quick-add"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <input
        type="text"
        placeholder={placeholder}
        aria-label={placeholder}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            // Inside a dialog, Escape would otherwise close the whole panel
            e.preventDefault()
            e.stopPropagation()
            onDone()
          }
        }}
        enterKeyHint="done"
        autoComplete="off"
        // Opened by an explicit tap on "+", so taking focus is what was asked for.
        autoFocus
      />
      <button type="submit" disabled={!body.trim()}>
        Add
      </button>
    </form>
  )
}
