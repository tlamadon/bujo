import PouchDB from 'pouchdb-browser'
import { createBujo, type AnyDoc } from '@bujo/core'

// Domain logic lives in @bujo/core (shared with the CLI). This module only
// owns the browser-side database, the sync, and binds core to the local db.
export * from '@bujo/core'

// Local PouchDB instance (IndexedDB under the hood)
export const localDb = new PouchDB<AnyDoc>('bujo')

// Remote CouchDB – resolve URL relative to current origin
const remoteUrl = `${window.location.origin}/couchdb/bujo`
export const remoteDb = new PouchDB<AnyDoc>(remoteUrl)

// ─── Sync ──────────────────────────────────────────────────────────
//
// Live bidirectional replication, behind a small hub rather than exported as
// the PouchDB object. Two reasons:
//
// - PouchDB gives up for good on a 401/403 (it does not retry those), so the
//   replication has to be replaceable: `restartSync()` starts a fresh one,
//   and listeners here outlive it.
// - The combined sync object drops the error from its 'paused' event. The
//   push and pull replications underneath still carry it, and say which
//   direction failed, so events are taken from those.

export type SyncDirection = 'push' | 'pull'

export type SyncEvent =
  /** One direction is replicating right now */
  | { type: 'active'; direction: SyncDirection }
  /** One direction is caught up and waiting for changes */
  | { type: 'idle'; direction: SyncDirection }
  /** A request failed. Not `fatal`: PouchDB is retrying. `fatal`: it has stopped. */
  | { type: 'problem'; direction: SyncDirection | null; error: unknown; fatal: boolean }
  /** The server refused individual documents */
  | { type: 'denied'; direction: SyncDirection | null; info: unknown }
  /** A new replication replaced the previous one */
  | { type: 'restart' }

const syncListeners = new Set<(event: SyncEvent) => void>()

function emitSync(event: SyncEvent): void {
  syncListeners.forEach((listener) => listener(event))
}

export function subscribeSync(listener: (event: SyncEvent) => void): () => void {
  syncListeners.add(listener)
  return () => {
    syncListeners.delete(listener)
  }
}

function startSync() {
  const handle = localDb.sync(remoteDb, { live: true, retry: true })
  // Events of a replication that has been replaced are not news.
  const current = () => handle === sync

  let lastFatal: unknown
  const watch = (direction: SyncDirection) => {
    // `push` and `pull` are there at runtime; the typings leave them out.
    const replication = (handle as unknown as Record<SyncDirection, PouchDB.Replication.Replication<AnyDoc>>)[direction]
    replication.on('active', () => current() && emitSync({ type: 'active', direction }))
    // 'paused' means caught up — or, when it carries an error, backing off before a retry
    replication.on('paused', (error: unknown) => {
      if (!current()) return
      emitSync(error ? { type: 'problem', direction, error, fatal: false } : { type: 'idle', direction })
    })
    replication.on('error', (error: unknown) => {
      lastFatal = error
      if (current()) emitSync({ type: 'problem', direction, error, fatal: true })
    })
  }
  watch('push')
  watch('pull')

  handle.on('denied', (info: unknown) => {
    const direction = (info as { direction?: SyncDirection } | null)?.direction ?? null
    if (current()) emitSync({ type: 'denied', direction, info })
  })
  // The combined object repeats a fatal error already reported, with its
  // direction, by the replication it came from. A handler is needed all the
  // same: an 'error' event nobody listens to is thrown.
  handle.on('error', (error: unknown) => {
    if (current() && error !== lastFatal) emitSync({ type: 'problem', direction: null, error, fatal: true })
  })
  return handle
}

let sync = startSync()

/** Abandon the current replication and start a new one. */
export function restartSync(): void {
  const previous = sync
  sync = startSync()
  previous.cancel()
  emitSync({ type: 'restart' })
}

// userId is injected by the server middleware, so none is passed here.
export const bujo = createBujo(localDb)

export const {
  getTag,
  getAllTags,
  setTagColor,
  getEntriesForTag,
  addEntry,
  addGoal,
  updateEntry,
  completeEntry,
  dropEntry,
  reopenEntry,
  deleteEntry,
  rescheduleEntry,
  resolveGhost,
  getEntriesForDate,
  getEntriesForDateRange,
  getEntriesForPeriod,
  getUnscheduledEntries,
  getMonthScheduledEntries,
  migrateOpenTasks,
} = bujo
