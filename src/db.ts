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

// Start live bidirectional sync
export const sync = localDb.sync(remoteDb, {
  live: true,
  retry: true,
})

// userId is injected by the server middleware, so none is passed here.
export const bujo = createBujo(localDb)

export const {
  getTag,
  getAllTags,
  setTagColor,
  getEntriesForTag,
  addEntry,
  updateEntry,
  deleteEntry,
  rescheduleEntry,
  resolveGhost,
  getEntriesForDate,
  getEntriesForDateRange,
  getUnscheduledEntries,
  migrateOpenTasks,
} = bujo
