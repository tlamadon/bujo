import PouchDB from 'pouchdb-browser'

/** BuJo signifier statuses */
export type BujoStatus =
  | 'task'       // • (bullet)
  | 'completed'  // ✕
  | 'migrated'   // > (moved forward)
  | 'scheduled'  // < (moved to future log)
  | 'note'       // – (dash)
  | 'event'      // ○ (circle)

export interface BujoEntry {
  _id: string
  _rev?: string
  type: 'entry'
  /** ISO date string YYYY-MM-DD */
  date: string
  status: BujoStatus
  body: string
  createdAt: number
}

// Local PouchDB instance (IndexedDB under the hood)
export const localDb = new PouchDB<BujoEntry>('bujo')

// Remote CouchDB – resolve URL relative to current origin
const remoteUrl = `${window.location.origin}/couchdb/bujo`
export const remoteDb = new PouchDB<BujoEntry>(remoteUrl)

// Start live bidirectional sync
export const sync = localDb.sync(remoteDb, {
  live: true,
  retry: true,
})

// Helper: generate a sortable unique ID (date-prefix for range queries)
export function makeId(date: string): string {
  return `${date}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
}

// ─── CRUD helpers ──────────────────────────────────────────────────

export async function addEntry(
  date: string,
  status: BujoStatus,
  body: string,
): Promise<void> {
  await localDb.put({
    _id: makeId(date),
    type: 'entry',
    date,
    status,
    body,
    createdAt: Date.now(),
  })
}

export async function updateEntry(
  entry: BujoEntry,
  fields: Partial<Pick<BujoEntry, 'status' | 'body' | 'date'>>,
): Promise<void> {
  await localDb.put({ ...entry, ...fields })
}

export async function deleteEntry(entry: BujoEntry): Promise<void> {
  await localDb.remove(entry._id, entry._rev!)
}

export async function getEntriesForDate(date: string): Promise<BujoEntry[]> {
  const result = await localDb.allDocs({
    include_docs: true,
    startkey: `${date}:`,
    endkey: `${date}:\ufff0`,
  })
  return result.rows
    .map((r) => r.doc!)
    .filter((d) => d.type === 'entry')
    .sort((a, b) => a.createdAt - b.createdAt)
}

export async function getEntriesForDateRange(
  startDate: string,
  endDate: string,
): Promise<BujoEntry[]> {
  const result = await localDb.allDocs({
    include_docs: true,
    startkey: `${startDate}:`,
    endkey: `${endDate}:\ufff0`,
  })
  return result.rows
    .map((r) => r.doc!)
    .filter((d) => d.type === 'entry')
    .sort((a, b) => a.createdAt - b.createdAt)
}

// ─── Migration Logic ───────────────────────────────────────────────

export async function migrateOpenTasks(today: string): Promise<number> {
  // Get all docs and filter for stale open tasks
  const result = await localDb.allDocs({ include_docs: true })
  const stale = result.rows
    .map((r) => r.doc!)
    .filter((d) => d.type === 'entry' && d.status === 'task' && d.date < today)

  if (stale.length === 0) return 0

  const ops: PouchDB.Core.PutDocument<BujoEntry>[] = []
  for (const entry of stale) {
    // Mark old entry as migrated
    ops.push({ ...entry, status: 'migrated' as BujoStatus })
    // Create new entry for today
    ops.push({
      _id: makeId(today),
      type: 'entry',
      date: today,
      status: 'task',
      body: entry.body,
      createdAt: Date.now(),
    })
  }
  await localDb.bulkDocs(ops)
  return stale.length
}
