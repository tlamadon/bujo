import { useEffect, useRef, useState } from 'react'
import { Close } from './Icons'
import { retrySync, useSyncStatus, type SyncState, type SyncStatus } from './syncStatus'

const LABELS: Record<SyncState, string> = {
  synced: 'Synced',
  syncing: 'Syncing',
  offline: 'Offline',
  error: 'Sync error',
  denied: 'Not saving',
  'auth-required': 'Login required',
}

/** What each state means when there is nothing more specific to say */
const PLAIN: Record<SyncState, string> = {
  synced: 'Everything on this device is saved on the server.',
  syncing: 'Exchanging changes with the server.',
  offline: 'The server cannot be reached.',
  error: 'Something went wrong while syncing.',
  denied: 'The server is not accepting changes from this browser.',
  'auth-required': 'Your sign-in has expired.',
}

async function reAuthenticate() {
  // The service worker binds all navigations to the cached index.html, so a
  // plain reload never reaches Cloudflare and the Access login page can't
  // challenge the user. Unregister the SW and clear its caches so the next
  // navigation goes over the wire. PouchDB data (IndexedDB) is untouched,
  // and the SW re-registers on the next load via useRegisterSW().
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((r) => r.unregister()))
    }
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }
  } catch {
    // Fall through and attempt the navigation anyway.
  }
  // Cache-bust query param so HTTP cache can't serve a stale shell either.
  window.location.href = `${window.location.origin}/?reauth=${Date.now()}`
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function SyncDetails({ status, onClose }: { status: SyncStatus; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [copied, setCopied] = useState(false)
  const { state, problem, lastSyncedAt } = status

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  const copy = async () => {
    if (!problem) return
    try {
      await navigator.clipboard.writeText(`${problem.summary}\n\n${problem.technical}`)
      setCopied(true)
    } catch {
      // No clipboard access (an insecure origin, a denied permission): the
      // text is on screen and can be selected by hand.
    }
  }

  // Logging in again only helps when the server does not know who this is
  const canLogIn = state === 'auth-required' || state === 'denied'

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      aria-labelledby="sync-details-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="sheet-content">
        <header className="sheet-header">
          <h2 id="sync-details-title" className={`sync-details-title sync-${state}`}>
            <span className="sync-dot" /> {LABELS[state]}
          </h2>
          <button type="button" className="icon-btn icon-btn-plain" onClick={onClose} aria-label="Close">
            <Close />
          </button>
        </header>

        <p className="sync-details-summary">{problem?.summary ?? PLAIN[state]}</p>
        {problem && <p className="sync-details-explanation">{problem.explanation}</p>}

        <p className="sync-details-last">
          {lastSyncedAt ? `Last in sync at ${formatTime(lastSyncedAt)}.` : 'Not in sync yet since the app was opened.'}
        </p>

        {state !== 'synced' && state !== 'syncing' && (
          <div className="sheet-actions">
            {canLogIn && (
              <button type="button" className="btn btn-primary" onClick={reAuthenticate}>
                Log in again
              </button>
            )}
            <button
              type="button"
              className={canLogIn ? 'btn' : 'btn btn-primary'}
              onClick={() => {
                retrySync()
                onClose()
              }}
            >
              Try again
            </button>
          </div>
        )}

        {problem && (
          <details className="sync-details-technical" open={state === 'error' || state === 'denied'}>
            <summary>Technical details</summary>
            <pre>{problem.technical}</pre>
            <button type="button" className="btn" onClick={copy}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </details>
        )}
      </div>
    </dialog>
  )
}

/** The sync state in the app bar. Tap it for what is going on, and what to do about it. */
export default function SyncIndicator() {
  const status = useSyncStatus()
  const [open, setOpen] = useState(false)
  const { state, problem } = status

  return (
    <>
      <div className={`sync-indicator sync-${state}`}>
        <button
          type="button"
          className="sync-status-btn"
          onClick={() => setOpen(true)}
          title={problem?.summary ?? PLAIN[state]}
          aria-label={`Sync: ${LABELS[state]}. Show details`}
        >
          <span className="sync-dot" />
          <span className="sync-label">{LABELS[state]}</span>
        </button>
        {state === 'auth-required' && (
          <button type="button" className="sync-reauth-btn" onClick={reAuthenticate}>
            Log in
          </button>
        )}
      </div>
      {open && <SyncDetails status={status} onClose={() => setOpen(false)} />}
    </>
  )
}
