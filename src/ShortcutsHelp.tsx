import { useEffect, useRef } from 'react'
import { Close } from './Icons'

const SHORTCUTS: [keys: string[], what: string][] = [
  [['1', '2', '3', '4', '5'], 'Daily, Weekly, Monthly, Future, Tags'],
  [['←', '→'], 'Previous / next day, week or month'],
  [['T'], 'Back to today'],
  [['N'], 'New entry'],
  [['Enter'], 'Edit the focused entry; save an edit'],
  [['Ctrl', 'Enter'], 'Save the details panel'],
  [['Esc'], 'Cancel an edit; close a panel'],
  [['?'], 'This help'],
]

export default function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      aria-labelledby="shortcuts-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="sheet-content">
        <header className="sheet-header">
          <h2 id="shortcuts-title">Keyboard shortcuts</h2>
          <button type="button" className="icon-btn icon-btn-plain" onClick={onClose} aria-label="Close">
            <Close />
          </button>
        </header>
        <dl className="shortcuts">
          {SHORTCUTS.map(([keys, what]) => (
            <div key={what}>
              <dt>
                {keys.map((k) => (
                  <kbd key={k}>{k}</kbd>
                ))}
              </dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
        <p className="task-detail-meta">BuJo v{__APP_VERSION__}</p>
      </div>
    </dialog>
  )
}
