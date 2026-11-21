import { makeGhostId, makeId } from './ids'
import { DEFAULT_TAG_COLORS, makeTagId, parseTags } from './tags'
import {
  UNSCHEDULED,
  isScheduledDate,
  type AnyDoc,
  type BujoDb,
  type BujoEntry,
  type BujoOptions,
  type BujoStatus,
  type DisplayEntry,
  type GhostEntry,
  type StoredDoc,
  type TagDoc,
} from './types'

/**
 * Bind the BuJo domain logic to a database.
 *
 * `db` is any PouchDB-compatible instance: `pouchdb-browser` in the PWA,
 * PouchDB with the memory adapter in tests, or an HTTP client talking to
 * CouchDB directly.
 */
export function createBujo(db: BujoDb, options: BujoOptions = {}) {
  const now = options.now ?? Date.now

  /** Add the configured userId (if any) to a document about to be written. */
  function stamp<T extends StoredDoc>(doc: T): T {
    return options.userId ? { ...doc, userId: options.userId } : doc
  }

  async function rangeDocs(startkey: string, endkey: string): Promise<AnyDoc[]> {
    const result = await db.allDocs({ include_docs: true, startkey, endkey })
    return result.rows.map((r) => r.doc as AnyDoc)
  }

  async function allDocs(): Promise<AnyDoc[]> {
    const result = await db.allDocs({ include_docs: true })
    return result.rows.map((r) => r.doc as AnyDoc)
  }

  // ─── Tags ────────────────────────────────────────────────────────

  async function getTag(name: string): Promise<TagDoc | null> {
    try {
      const doc = (await db.get(makeTagId(name))) as AnyDoc
      return doc.type === 'tag' ? doc : null
    } catch {
      return null
    }
  }

  async function getAllTags(): Promise<TagDoc[]> {
    const docs = await rangeDocs('tag:', 'tag:￰')
    return docs.filter((d): d is TagDoc => d.type === 'tag')
  }

  async function setTagColor(name: string, color: string): Promise<void> {
    const id = makeTagId(name)
    let existing: TagDoc | null = null
    try {
      existing = (await db.get(id)) as TagDoc
    } catch {
      existing = null
    }
    if (existing) {
      await db.put(stamp({ ...existing, color }))
    } else {
      await db.put(stamp<TagDoc>({ _id: id, type: 'tag', name: name.toLowerCase(), color }))
    }
  }

  /** Ensure tag docs exist for all given tag names (auto-assign colors) */
  async function ensureTagDocs(tags: string[]): Promise<void> {
    const existing = await getAllTags()
    const existingNames = new Set(existing.map((t) => t.name))
    for (const tag of tags) {
      if (!existingNames.has(tag)) {
        const colorIdx = (existing.length + tags.indexOf(tag)) % DEFAULT_TAG_COLORS.length
        await db.put(
          stamp<TagDoc>({
            _id: makeTagId(tag),
            type: 'tag',
            name: tag,
            color: DEFAULT_TAG_COLORS[colorIdx],
          }),
        )
      }
    }
  }

  async function getEntriesForTag(tagName: string): Promise<BujoEntry[]> {
    const wanted = tagName.toLowerCase()
    const docs = await allDocs()
    return docs.filter((d): d is BujoEntry => d.type === 'entry' && !!d.tags?.includes(wanted))
  }

  // ─── CRUD ────────────────────────────────────────────────────────

  async function addEntry(date: string, status: BujoStatus, body: string): Promise<BujoEntry> {
    const tags = parseTags(body)
    if (tags.length > 0) await ensureTagDocs(tags)
    const createdAt = now()
    const entry: BujoEntry = stamp({
      _id: makeId(date, createdAt),
      type: 'entry',
      date,
      status,
      body,
      createdAt,
      ...(tags.length > 0 ? { tags } : {}),
    })
    const res = await db.put(entry)
    return { ...entry, _rev: res.rev }
  }

  async function updateEntry(
    entry: BujoEntry,
    fields: Partial<Pick<BujoEntry, 'status' | 'body' | 'date'>>,
  ): Promise<BujoEntry> {
    const merged: BujoEntry = { ...entry, ...fields }
    const tags = parseTags(merged.body)
    if (tags.length > 0) await ensureTagDocs(tags)
    if (tags.length > 0) merged.tags = tags
    else delete merged.tags
    const res = await db.put(stamp(merged))
    return { ...merged, _rev: res.rev }
  }

  async function deleteEntry(entry: BujoEntry): Promise<void> {
    // Delete ghosts that reference this entry
    const ghosts = await getGhostsForRef(entry._id)
    const ops: StoredDoc[] = ghosts.map((g) => ({ ...g, _deleted: true }))
    if (ops.length > 0) await db.bulkDocs(ops)
    await db.remove(entry._id, entry._rev!)
  }

  // ─── Reschedule ──────────────────────────────────────────────────

  /**
   * Reschedule an entry to a new date.
   * - Creates a ghost on the old date (so it shows as ">" there)
   * - Deletes the old entry and creates a new one with a new _id
   *   keyed to the new date (so allDocs range queries find it)
   * - Preserves dateHistory on the new entry
   */
  async function rescheduleEntry(entry: BujoEntry, newDate: string): Promise<BujoEntry> {
    const oldDate = entry.date
    const history = [...(entry.dateHistory || []), oldDate]
    const newId = makeId(newDate, now())

    // Create the new entry on the new date
    const moved: BujoEntry = stamp({
      _id: newId,
      type: 'entry',
      date: newDate,
      status: entry.status,
      body: entry.body,
      createdAt: entry.createdAt,
      dateHistory: history,
      ...(entry.tags && entry.tags.length > 0 ? { tags: entry.tags } : {}),
    })
    const res = await db.put(moved)

    // Create a ghost on the old date pointing to the NEW entry (skip for special dates)
    if (isScheduledDate(oldDate)) {
      await db.put(
        stamp<GhostEntry>({
          _id: makeGhostId(oldDate, newId),
          type: 'ghost',
          date: oldDate,
          ref: newId,
        }),
      )
    }

    // Update any existing ghosts that pointed to the old entry
    const oldGhosts = await getGhostsForRef(entry._id)
    if (oldGhosts.length > 0) {
      await db.bulkDocs(oldGhosts.map((g) => stamp({ ...g, ref: newId })))
    }

    // Delete the old entry
    await db.remove(entry._id, entry._rev!)
    return { ...moved, _rev: res.rev }
  }

  // ─── Queries ─────────────────────────────────────────────────────

  async function getGhostsForRef(ref: string): Promise<GhostEntry[]> {
    const docs = await rangeDocs('ghost:', 'ghost:￰')
    return docs.filter((d): d is GhostEntry => d.type === 'ghost' && d.ref === ref)
  }

  async function getGhostsForDateRange(startDate: string, endDate: string): Promise<GhostEntry[]> {
    const docs = await rangeDocs(`ghost:${startDate}:`, `ghost:${endDate}:￰`)
    return docs.filter((d): d is GhostEntry => d.type === 'ghost')
  }

  /** Resolve a ghost to its parent entry, or null if parent was deleted */
  async function resolveGhost(ghost: GhostEntry): Promise<BujoEntry | null> {
    try {
      const doc = (await db.get(ghost.ref)) as AnyDoc
      return doc.type === 'entry' ? doc : null
    } catch {
      return null
    }
  }

  /** Entries dated within [startDate, endDate], plus ghosts left on those dates. */
  async function getEntriesForDateRange(startDate: string, endDate: string): Promise<DisplayEntry[]> {
    // Get real entries by _id prefix range
    const docs = await rangeDocs(`${startDate}:`, `${endDate}:￰`)
    const entries: DisplayEntry[] = docs
      .filter((d): d is BujoEntry => d.type === 'entry')
      .map((entry) => ({ entry, isGhost: false }))

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

  function getEntriesForDate(date: string): Promise<DisplayEntry[]> {
    return getEntriesForDateRange(date, date)
  }

  async function getUnscheduledEntries(): Promise<BujoEntry[]> {
    const docs = await rangeDocs(`${UNSCHEDULED}:`, `${UNSCHEDULED}:￰`)
    return docs.filter((d): d is BujoEntry => d.type === 'entry')
  }

  // ─── Migration ───────────────────────────────────────────────────

  /** Move every open task dated before `today` onto `today`. Returns how many moved. */
  async function migrateOpenTasks(today: string): Promise<number> {
    const docs = await allDocs()
    const stale = docs.filter(
      (d): d is BujoEntry =>
        d.type === 'entry' && d.status === 'task' && isScheduledDate(d.date) && d.date < today,
    )
    for (const entry of stale) {
      await rescheduleEntry(entry, today)
    }
    return stale.length
  }

  return {
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
  }
}

export type Bujo = ReturnType<typeof createBujo>
