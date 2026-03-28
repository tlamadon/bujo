import PouchDB from 'pouchdb-browser'

/** BuJo signifier statuses */
export type BujoStatus =
  | 'task'       // • (bullet)
  | 'completed'  // ✕
  | 'migrated'   // > (moved forward)
  | 'scheduled'  // > (moved to future log)
  | 'note'       // – (dash)
  | 'event'      // ○ (circle)

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
  /** ISO date string YYYY-MM-DD, or a special value like UNSCHEDULED */
  date: string
  status: BujoStatus
  body: string
  createdAt: number
  userId?: string
  /** Previous dates this entry was scheduled on (oldest first) */
  dateHistory?: string[]
  /** Tags extracted from body text (e.g. #work, #home) */
  tags?: string[]
}

export interface TagDoc {
  _id: string
  _rev?: string
  type: 'tag'
  name: string
  color: string
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

type AnyDoc = BujoEntry | GhostEntry | TagDoc

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

// ─── Tag helpers ───────────────────────────────────────────────────

/** Extract #tags from body text. Returns lowercase, deduplicated tag names. */
export function parseTags(body: string): string[] {
  const matches = body.match(/#([a-zA-Z0-9_-]+)/g)
  if (!matches) return []
  const tags = [...new Set(matches.map((m) => m.slice(1).toLowerCase()))]
  return tags
}

/** Return body text with #tags stripped out and trimmed. */
export function stripTags(body: string): string {
  return body.replace(/#[a-zA-Z0-9_-]+/g, '').replace(/\s{2,}/g, ' ').trim()
}

const DEFAULT_TAG_COLORS = [
  '#7aa2d4', '#d4a27a', '#b39ddb', '#4caf50', '#e57373',
  '#4dd0e1', '#fff176', '#a1887f', '#90a4ae', '#f48fb1',
]

function makeTagId(name: string): string {
  return `tag:${name.toLowerCase()}`
}

export async function getTag(name: string): Promise<TagDoc | null> {
  try {
    const doc = await localDb.get(makeTagId(name))
    return doc.type === 'tag' ? (doc as TagDoc) : null
  } catch {
    return null
  }
}

export async function getAllTags(): Promise<TagDoc[]> {
  const result = await localDb.allDocs({
    include_docs: true,
    startkey: 'tag:',
    endkey: 'tag:\ufff0',
  })
  return result.rows
    .map((r) => r.doc! as AnyDoc)
    .filter((d) => d.type === 'tag') as TagDoc[]
}

export async function setTagColor(name: string, color: string): Promise<void> {
  const id = makeTagId(name)
  try {
    const existing = await localDb.get(id)
    await localDb.put({ ...existing, color } as TagDoc)
  } catch {
    await localDb.put({
      _id: id,
      type: 'tag',
      name: name.toLowerCase(),
      color,
    } as TagDoc)
  }
}

/** Ensure tag docs exist for all given tag names (auto-assign colors) */
async function ensureTagDocs(tags: string[]): Promise<void> {
  const existing = await getAllTags()
  const existingNames = new Set(existing.map((t) => t.name))
  for (const tag of tags) {
    if (!existingNames.has(tag)) {
      const colorIdx = (existing.length + tags.indexOf(tag)) % DEFAULT_TAG_COLORS.length
      await localDb.put({
        _id: makeTagId(tag),
        type: 'tag',
        name: tag,
        color: DEFAULT_TAG_COLORS[colorIdx],
      } as TagDoc)
    }
  }
}

export async function getEntriesForTag(tagName: string): Promise<BujoEntry[]> {
  const result = await localDb.allDocs({ include_docs: true })
  return result.rows
    .map((r) => r.doc! as AnyDoc)
    .filter(
      (d) =>
        d.type === 'entry' &&
        (d as BujoEntry).tags?.includes(tagName.toLowerCase()),
    ) as BujoEntry[]
}

// ─── CRUD helpers ──────────────────────────────────────────────────

export async function addEntry(
  date: string,
  status: BujoStatus,
  body: string,
): Promise<void> {
  const tags = parseTags(body)
  if (tags.length > 0) await ensureTagDocs(tags)
  await localDb.put({
    _id: makeId(date),
    type: 'entry',
    date,
    status,
    body,
    createdAt: Date.now(),
    ...(tags.length > 0 ? { tags } : {}),
  })
}

export async function updateEntry(
  entry: BujoEntry,
  fields: Partial<Pick<BujoEntry, 'status' | 'body' | 'date'>>,
): Promise<void> {
  const merged = { ...entry, ...fields }
  const tags = parseTags(merged.body)
  if (tags.length > 0) await ensureTagDocs(tags)
  merged.tags = tags.length > 0 ? tags : undefined
  await localDb.put(merged)
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
    ...(entry.tags && entry.tags.length > 0 ? { tags: entry.tags } : {}),
  })

  // Create a ghost on the old date pointing to the NEW entry (skip for special dates)
  if (isScheduledDate(oldDate)) {
    await localDb.put({
      _id: makeGhostId(oldDate, newId),
      type: 'ghost',
      date: oldDate,
      ref: newId,
    })
  }

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

// ─── Unscheduled queries ──────────────────────────────────────────

export async function getUnscheduledEntries(): Promise<BujoEntry[]> {
  const result = await localDb.allDocs({
    include_docs: true,
    startkey: `${UNSCHEDULED}:`,
    endkey: `${UNSCHEDULED}:\ufff0`,
  })
  return result.rows
    .map((r) => r.doc! as AnyDoc)
    .filter((d) => d.type === 'entry') as BujoEntry[]
}

// ─── Migration Logic ───────────────────────────────────────────────

export async function migrateOpenTasks(today: string): Promise<number> {
  const result = await localDb.allDocs({ include_docs: true })
  const stale = result.rows
    .map((r) => r.doc! as AnyDoc)
    .filter((d) => d.type === 'entry' && (d as BujoEntry).status === 'task' && isScheduledDate(d.date) && d.date < today) as BujoEntry[]

  if (stale.length === 0) return 0

  for (const entry of stale) {
    await rescheduleEntry(entry, today)
  }
  return stale.length
}
