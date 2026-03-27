import PouchDB from 'pouchdb-browser'

/** BuJo signifier statuses */
export type BujoStatus =
  | 'task'       // • (bullet)
  | 'completed'  // ✕
  | 'migrated'   // > (moved forward)
  | 'scheduled'  // > (moved to future log)
  | 'note'       // – (dash)
  | 'event'      // ○ (circle)

export interface BujoEntry {
  _id: string
  _rev?: string
  type: 'entry'
  /** ISO date string YYYY-MM-DD — the current active date */
  date: string
  status: BujoStatus
  body: string
  createdAt: number
  userId?: string
  /** Previous dates this entry was scheduled on (oldest first) */
  dateHistory?: string[]
}

export interface GhostEntry {
  _id: string
  _rev?: string
  type: 'ghost'
  /** The date this ghost appears on */
  date: string
  /** The _id of the parent BujoEntry */
  ref: string
}

type AnyDoc = BujoEntry | GhostEntry

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

// Helper: generate a sortable unique ID (date-prefix for range queries)
export function makeId(date: string): string {
  return `${date}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
}

function makeGhostId(date: string, ref: string): string {
  return `ghost:${date}:${ref}`
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
  // Delete ghosts that reference this entry
  const ghosts = await getGhostsForRef(entry._id)
  const ops: AnyDoc[] = ghosts.map((g) => ({ ...g, _deleted: true }) as any)
  if (ops.length > 0) await localDb.bulkDocs(ops)
  await localDb.remove(entry._id, entry._rev!)
}

// ─── Reschedule ──────────────────────────────────────────────────

/**
 * Reschedule an entry to a new date.
 * - Creates a ghost on the old date (so it shows as ">" there)
 * - Deletes the old entry and creates a new one with a new _id
 *   keyed to the new date (so allDocs range queries find it)
 * - Preserves dateHistory on the new entry
 */
export async function rescheduleEntry(
  entry: BujoEntry,
  newDate: string,
): Promise<void> {
  const oldDate = entry.date
  const history = [...(entry.dateHistory || []), oldDate]
  const newId = makeId(newDate)

  // Create the new entry on the new date
  await localDb.put({
    _id: newId,
    type: 'entry',
    date: newDate,
    status: entry.status,
    body: entry.body,
    createdAt: entry.createdAt,
    dateHistory: history,
  })

  // Create a ghost on the old date pointing to the NEW entry
  await localDb.put({
    _id: makeGhostId(oldDate, newId),
    type: 'ghost',
    date: oldDate,
    ref: newId,
  })

  // Update any existing ghosts that pointed to the old entry
  const oldGhosts = await getGhostsForRef(entry._id)
  if (oldGhosts.length > 0) {
    const updates = oldGhosts.map((g) => ({ ...g, ref: newId }))
    await localDb.bulkDocs(updates)
  }

  // Delete the old entry
  await localDb.remove(entry._id, entry._rev!)
}

// ─── Query helpers ───────────────────────────────────────────────

async function getGhostsForRef(ref: string): Promise<GhostEntry[]> {
  const result = await localDb.allDocs({ include_docs: true, startkey: 'ghost:', endkey: 'ghost:\ufff0' })
  return result.rows
    .map((r) => r.doc! as AnyDoc)
    .filter((d) => d.type === 'ghost' && (d as GhostEntry).ref === ref) as GhostEntry[]
}

async function getGhostsForDate(date: string): Promise<GhostEntry[]> {
  const result = await localDb.allDocs({
    include_docs: true,
    startkey: `ghost:${date}:`,
    endkey: `ghost:${date}:\ufff0`,
  })
  return result.rows
    .map((r) => r.doc! as AnyDoc)
    .filter((d) => d.type === 'ghost') as GhostEntry[]
}

async function getGhostsForDateRange(startDate: string, endDate: string): Promise<GhostEntry[]> {
  const result = await localDb.allDocs({
    include_docs: true,
    startkey: `ghost:${startDate}:`,
    endkey: `ghost:${endDate}:\ufff0`,
  })
  return result.rows
    .map((r) => r.doc! as AnyDoc)
    .filter((d) => d.type === 'ghost') as GhostEntry[]
}

/** Resolve a ghost to its parent entry, or null if parent was deleted */
export async function resolveGhost(ghost: GhostEntry): Promise<BujoEntry | null> {
  try {
    const doc = await localDb.get(ghost.ref)
    return doc.type === 'entry' ? doc as BujoEntry : null
  } catch {
    return null
  }
}

export interface DisplayEntry {
  entry: BujoEntry
  /** If this is a ghost appearance (rescheduled away from this date) */
  isGhost: boolean
  ghostDoc?: GhostEntry
}

export async function getEntriesForDate(date: string): Promise<DisplayEntry[]> {
  // Get real entries by _id prefix
  const entryResult = await localDb.allDocs({
    include_docs: true,
    startkey: `${date}:`,
    endkey: `${date}:\ufff0`,
  })
  const entries: DisplayEntry[] = entryResult.rows
    .map((r) => r.doc! as AnyDoc)
    .filter((d) => d.type === 'entry')
    .map((entry) => ({ entry: entry as BujoEntry, isGhost: false as const }))

  // Get ghosts for this date and resolve them
  const ghosts = await getGhostsForDate(date)
  for (const ghost of ghosts) {
    const parent = await resolveGhost(ghost)
    if (parent) {
      entries.push({ entry: parent, isGhost: true, ghostDoc: ghost })
    }
  }

  entries.sort((a, b) => a.entry.createdAt - b.entry.createdAt)
  return entries
}

export async function getEntriesForDateRange(
  startDate: string,
  endDate: string,
): Promise<DisplayEntry[]> {
  // Get real entries by _id prefix range
  const entryResult = await localDb.allDocs({
    include_docs: true,
    startkey: `${startDate}:`,
    endkey: `${endDate}:\ufff0`,
  })
  const entries: DisplayEntry[] = entryResult.rows
    .map((r) => r.doc! as AnyDoc)
    .filter((d) => d.type === 'entry')
    .map((entry) => ({ entry: entry as BujoEntry, isGhost: false as const }))

  // Get ghosts for this date range and resolve them
  const ghosts = await getGhostsForDateRange(startDate, endDate)
  for (const ghost of ghosts) {
    const parent = await resolveGhost(ghost)
    if (parent) {
      entries.push({ entry: parent, isGhost: true, ghostDoc: ghost })
    }
  }

  entries.sort((a, b) => a.entry.createdAt - b.entry.createdAt)
  return entries
}

// ─── Migration Logic ───────────────────────────────────────────────

export async function migrateOpenTasks(today: string): Promise<number> {
  const result = await localDb.allDocs({ include_docs: true })
  const stale = result.rows
    .map((r) => r.doc! as AnyDoc)
    .filter((d) => d.type === 'entry' && (d as BujoEntry).status === 'task' && d.date < today) as BujoEntry[]

  if (stale.length === 0) return 0

  for (const entry of stale) {
    await rescheduleEntry(entry, today)
  }
  return stale.length
}
