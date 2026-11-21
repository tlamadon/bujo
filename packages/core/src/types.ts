/** BuJo signifier statuses */
export type BujoStatus =
  | 'task'       // • (bullet)
  | 'completed'  // ✕
  | 'migrated'   // > (moved forward)
  | 'scheduled'  // > (moved to future log)
  | 'note'       // – (dash)
  | 'event'      // ○ (circle)
  | 'dropped'    // struck through: cancelled / no longer relevant
  | 'goal'       // a weekly or monthly goal; progress is in `goalState`

/** How a goal ended. A goal without a state is still open. */
export type GoalState = 'achieved' | 'dropped'

/** Special date values (sort after ISO dates via ~ prefix) */
export const UNSCHEDULED = '~unscheduled'

/** Check whether a date value is a real calendar date */
export function isScheduledDate(date: string): boolean {
  return !date.startsWith('~')
}

export interface BujoEntry {
  _id: string
  _rev?: string
  type: 'entry'
  /**
   * When the entry is for. A day `YYYY-MM-DD`, a month `YYYY-MM` (future log
   * items and monthly goals), an ISO week `YYYY-Www` (weekly goals), or
   * UNSCHEDULED. See dates.ts.
   */
  date: string
  status: BujoStatus
  body: string
  createdAt: number
  userId?: string
  /** Previous dates this entry was scheduled on (oldest first) */
  dateHistory?: string[]
  /** Tags extracted from body text (e.g. #work, #home) */
  tags?: string[]
  /** The BuJo `*` signifier. Absent means not a priority. */
  priority?: boolean
  /** Time of day `HH:MM` (24h). Events only. */
  time?: string
  /** Goals only: how the goal ended. Absent while it is open. */
  goalState?: GoalState
  /** The status an entry had before it was completed or dropped, so it can be reopened as that. */
  prevStatus?: BujoStatus
}

export interface TagDoc {
  _id: string
  _rev?: string
  type: 'tag'
  name: string
  color: string
  userId?: string
}

export interface GhostEntry {
  _id: string
  _rev?: string
  type: 'ghost'
  /** The date this ghost appears on */
  date: string
  /** The _id of the parent BujoEntry */
  ref: string
  userId?: string
}

export type AnyDoc = BujoEntry | GhostEntry | TagDoc

export interface DisplayEntry {
  entry: BujoEntry
  /** If this is a ghost appearance (rescheduled away from this date) */
  isGhost: boolean
  ghostDoc?: GhostEntry
}

// ─── Database abstraction ─────────────────────────────────────────
//
// The subset of the PouchDB API that core needs. A PouchDB instance
// (pouchdb-browser, pouchdb + memory adapter, …) satisfies it structurally,
// and so does a thin fetch-based CouchDB client.

/** A document as stored: anything with an `_id`. */
export interface StoredDoc {
  _id: string
  _rev?: string
  _deleted?: boolean
}

/** Result of a write. Failures inside `bulkDocs` are reported per document. */
export interface DbWriteResult {
  ok?: boolean
  id?: string
  rev?: string
  /** Truthy when this document failed to write */
  error?: unknown
  status?: number
  name?: string
  message?: string
}

export interface DbRow {
  id: string
  value?: { rev: string; deleted?: boolean }
  doc?: unknown
}

export interface AllDocsOptions {
  include_docs?: boolean
  startkey?: string
  endkey?: string
  /** Fetch exactly these ids. Rows for missing or deleted ids carry no `doc`. */
  keys?: string[]
}

export interface BujoDb {
  /** Rejects with `{ status: 404 }` when the document does not exist. */
  get(id: string): Promise<unknown>
  /** Rejects with `{ status: 409 }` on a revision conflict. */
  put(doc: StoredDoc): Promise<DbWriteResult>
  remove(id: string, rev: string): Promise<DbWriteResult>
  allDocs(options?: AllDocsOptions): Promise<{ rows: DbRow[] }>
  bulkDocs(docs: StoredDoc[]): Promise<DbWriteResult[]>
}

export interface BujoOptions {
  /**
   * Stamp this user id on every document written. Leave unset when a server
   * in front of CouchDB injects it (the Hono middleware does).
   */
  userId?: string
  /** Clock, in epoch milliseconds. Defaults to `Date.now`. */
  now?: () => number
}
