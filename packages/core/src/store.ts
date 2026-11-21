import { AmbiguousError, InvalidError, NotFoundError, isConflict, isMissing } from './errors'
import { idTail, makeGhostId, makeId, refOf, withDate } from './ids'
import { DEFAULT_TAG_COLORS, makeTagId, parseTags } from './tags'
import {
  UNSCHEDULED,
  isScheduledDate,
  type AnyDoc,
  type BujoDb,
  type BujoEntry,
  type BujoOptions,
  type BujoStatus,
  type DbWriteResult,
  type DisplayEntry,
  type GhostEntry,
  type StoredDoc,
  type TagDoc,
} from './types'

/** How many times a write is retried after a revision conflict. */
const MAX_RETRIES = 5

/** How to pick between several entries matching a body substring. */
export interface FindOptions {
  /**
   * Entries the caller is most likely after (e.g. open tasks for `done`).
   * A substring is matched against these first; the rest are only considered
   * when none of them match. Refs and ids are always matched exactly.
   */
  prefer?: (entry: BujoEntry) => boolean
}

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

  async function getOrNull(id: string): Promise<AnyDoc | null> {
    try {
      return (await db.get(id)) as AnyDoc
    } catch (err) {
      if (isMissing(err)) return null
      throw err
    }
  }

  /**
   * Write `doc`, replacing whatever is stored under its id. On a revision
   * conflict the current revision is looked up and the write retried.
   */
  async function putOver<T extends StoredDoc>(doc: T, rev?: string): Promise<DbWriteResult> {
    let current = rev
    for (let attempt = 0; ; attempt++) {
      try {
        return await db.put(current ? { ...doc, _rev: current } : doc)
      } catch (err) {
        if (!isConflict(err) || attempt >= MAX_RETRIES) throw err
        current = (await getOrNull(doc._id))?._rev
      }
    }
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
    const docs = await rangeDocs('tag:', 'tag:\ufff0')
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
        try {
          await db.put(
            stamp<TagDoc>({
              _id: makeTagId(tag),
              type: 'tag',
              name: tag,
              color: DEFAULT_TAG_COLORS[colorIdx],
            }),
          )
        } catch (err) {
          // Another client created the same tag in the meantime: nothing to do.
          if (!isConflict(err)) throw err
        }
      }
    }
  }

  async function getEntriesForTag(tagName: string): Promise<BujoEntry[]> {
    const wanted = tagName.toLowerCase()
    const entries = await getAllEntries()
    return entries.filter((e) => !!e.tags?.includes(wanted))
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

  /**
   * Change fields of an entry. `entry` may be stale: on a revision conflict
   * the change is re-applied to the latest stored version.
   */
  async function updateEntry(
    entry: BujoEntry,
    fields: Partial<Pick<BujoEntry, 'status' | 'body'>>,
  ): Promise<BujoEntry> {
    let base = entry
    for (let attempt = 0; ; attempt++) {
      const merged: BujoEntry = { ...base, ...fields }
      const tags = parseTags(merged.body)
      if (tags.length > 0) await ensureTagDocs(tags)
      if (tags.length > 0) merged.tags = tags
      else delete merged.tags
      try {
        const res = await db.put(stamp(merged))
        return { ...merged, _rev: res.rev }
      } catch (err) {
        if (!isConflict(err) || attempt >= MAX_RETRIES) throw err
        const latest = await getOrNull(entry._id)
        if (!latest || latest.type !== 'entry') throw err
        base = latest
      }
    }
  }

  async function deleteEntry(entry: BujoEntry): Promise<void> {
    // Delete ghosts that reference this entry
    const ghosts = await getGhostsOf(entry._id)
    const ops: StoredDoc[] = ghosts.map((g) => ({ ...g, _deleted: true }))
    if (ops.length > 0) await db.bulkDocs(ops)

    let rev = entry._rev
    for (let attempt = 0; ; attempt++) {
      try {
        await db.remove(entry._id, rev!)
        return
      } catch (err) {
        const latest = await getOrNull(entry._id)
        if (!latest) return // already gone
        if (attempt >= MAX_RETRIES || latest._rev === rev) throw err
        rev = latest._rev
      }
    }
  }

  // ─── Reschedule ──────────────────────────────────────────────────

  /**
   * Reschedule an entry to a new date.
   *
   * The entry keeps its identity: only the date prefix of its `_id` changes,
   * the `${createdAt}:${uid}` tail (and so the short ref) stays the same.
   * Because CouchDB cannot rename a document, this still means writing the
   * entry under the new id and deleting the old one.
   *
   * - `dateHistory` gains the date the entry is leaving
   * - a ghost is left on the old date (so it shows as ">" there)
   * - the entry's other ghosts are repointed at the new id
   * - a ghost on the destination date is removed: the entry is back there
   *
   * Writes happen new-entry-first, so an interruption leaves a duplicate
   * rather than losing the entry, and running the same move again heals it.
   * That also makes the move idempotent across devices: two clients migrating
   * the same task to the same day produce the same document, not two copies.
   */
  async function rescheduleEntry(entry: BujoEntry, newDate: string): Promise<BujoEntry> {
    const oldId = entry._id
    const oldDate = entry.date
    if (newDate === oldDate) return entry
    const newId = withDate(oldId, newDate)

    let source = entry
    let newRev: string | undefined
    for (let attempt = 0; ; attempt++) {
      const moved: BujoEntry = stamp({
        ...source,
        _id: newId,
        date: newDate,
        dateHistory: [...(source.dateHistory || []), oldDate],
      })
      delete moved._rev

      // Create the entry on the new date (or refresh it on a retry)
      newRev = (await putOver(moved, newRev)).rev
      if (attempt === 0) await moveGhosts(oldId, newId, oldDate, newDate)

      // Delete the old entry
      try {
        await db.remove(oldId, source._rev!)
        return { ...moved, _rev: newRev }
      } catch (err) {
        const latest = await getOrNull(oldId)
        if (!latest || latest.type !== 'entry') return { ...moved, _rev: newRev } // already gone
        if (attempt >= MAX_RETRIES || latest._rev === source._rev) throw err
        // The entry changed since the caller read it: carry the newer version over.
        source = latest
      }
    }
  }

  /**
   * Bring an entry's ghosts in line with a move from `oldDate` to `newDate`:
   * exactly one ghost on every day it used to be on, none where it is now,
   * all of them pointing at `newId`.
   */
  async function moveGhosts(
    oldId: string,
    newId: string,
    oldDate: string,
    newDate: string,
  ): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      const ghosts = await getGhostsOf(oldId)
      const ops: StoredDoc[] = []
      const haunted = new Set<string>()
      for (const ghost of ghosts) {
        if (ghost.date === newDate || haunted.has(ghost.date)) {
          ops.push({ ...ghost, _deleted: true })
        } else {
          haunted.add(ghost.date)
          if (ghost.ref !== newId) ops.push(stamp({ ...ghost, ref: newId }))
        }
      }
      // Leave a ghost on the date the entry is leaving (skip for special dates)
      if (isScheduledDate(oldDate) && !haunted.has(oldDate)) {
        const ghost: GhostEntry = {
          _id: makeGhostId(oldDate, newId),
          type: 'ghost',
          date: oldDate,
          ref: newId,
        }
        // The id may have been used before (the entry left this day earlier,
        // came back and is leaving again), so write over any old revision.
        const previous = await getOrNull(ghost._id)
        ops.push(stamp(previous ? { ...ghost, _rev: previous._rev } : ghost))
      }
      if (ops.length === 0) return

      const results = await db.bulkDocs(ops)
      const failed = results.filter((r) => r.error)
      if (failed.length === 0) return
      if (attempt >= MAX_RETRIES || !failed.every(isConflict)) {
        throw new Error(`Could not update ghosts: ${failed[0].message ?? failed[0].name ?? 'write failed'}`)
      }
    }
  }

  // ─── Queries ─────────────────────────────────────────────────────

  /**
   * Every ghost of an entry: those pointing at its current id, plus any whose
   * own id carries the entry's tail (which also catches ghosts that were not
   * repointed after an interrupted move).
   */
  async function getGhostsOf(entryId: string): Promise<GhostEntry[]> {
    const suffix = `:${idTail(entryId)}`
    const docs = await rangeDocs('ghost:', 'ghost:\ufff0')
    return docs.filter(
      (d): d is GhostEntry => d.type === 'ghost' && (d.ref === entryId || d._id.endsWith(suffix)),
    )
  }

  async function getGhostsForDateRange(startDate: string, endDate: string): Promise<GhostEntry[]> {
    const docs = await rangeDocs(`ghost:${startDate}:`, `ghost:${endDate}:\ufff0`)
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
    const docs = await rangeDocs(`${startDate}:`, `${endDate}:\ufff0`)
    const entries: DisplayEntry[] = docs
      .filter((d): d is BujoEntry => d.type === 'entry')
      .map((entry) => ({ entry, isGhost: false }))

    // Get ghosts for this date range and resolve them
    const ghosts = await getGhostsForDateRange(startDate, endDate)
    for (const ghost of ghosts) {
      const parent = await resolveGhost(ghost)
      // A ghost on the day its entry currently sits on says nothing: skip it.
      if (parent && parent.date !== ghost.date) {
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
    const docs = await rangeDocs(`${UNSCHEDULED}:`, `${UNSCHEDULED}:\ufff0`)
    return docs.filter((d): d is BujoEntry => d.type === 'entry')
  }

  async function getAllEntries(): Promise<BujoEntry[]> {
    const docs = await allDocs()
    return docs.filter((d): d is BujoEntry => d.type === 'entry')
  }

  // ─── References ──────────────────────────────────────────────────

  function matchQuery(query: string, entries: BujoEntry[], options: FindOptions): BujoEntry {
    const q = query.trim()
    if (!q) throw new InvalidError('Empty entry reference')

    // 1. Full _id — current, or an older one whose date prefix is out of date
    if (q.includes(':')) {
      const exact = entries.find((e) => e._id === q)
      if (exact) return exact
      const suffix = `:${idTail(q)}`
      const byTail = entries.filter((e) => e._id.endsWith(suffix))
      if (byTail.length === 1) return byTail[0]
    }

    // 2. Short ref
    const ref = q.toLowerCase()
    const byRef = entries.filter((e) => refOf(e._id) === ref)
    if (byRef.length === 1) return byRef[0]
    if (byRef.length > 1) {
      throw new AmbiguousError(`Ref "${q}" matches ${byRef.length} entries; use the full id`, byRef)
    }

    // 3. Body substring, preferred entries first
    const bySubstring = entries.filter((e) => e.body.toLowerCase().includes(ref))
    const preferred = options.prefer ? bySubstring.filter(options.prefer) : []
    const pool = preferred.length > 0 ? preferred : bySubstring
    if (pool.length === 1) return pool[0]
    if (pool.length === 0) throw new NotFoundError(`No entry matches "${q}"`)
    throw new AmbiguousError(`"${q}" matches ${pool.length} entries; use a ref`, pool)
  }

  /**
   * Resolve references to entries. Each may be a short ref, a full `_id`
   * (even one from before a reschedule), or a unique body substring.
   * Throws NotFoundError / AmbiguousError; nothing is returned unless every
   * reference resolves.
   */
  async function findEntries(queries: string[], options: FindOptions = {}): Promise<BujoEntry[]> {
    const entries = await getAllEntries()
    return queries.map((q) => matchQuery(q, entries, options))
  }

  async function findEntry(query: string, options: FindOptions = {}): Promise<BujoEntry> {
    const [entry] = await findEntries([query], options)
    return entry
  }

  // ─── Migration ───────────────────────────────────────────────────

  /** Move every open task dated before `today` onto `today`. Returns how many moved. */
  async function migrateOpenTasks(today: string): Promise<number> {
    const entries = await getAllEntries()
    const stale = entries.filter(
      (e) => e.status === 'task' && isScheduledDate(e.date) && e.date < today,
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
    getGhostsOf,
    getAllEntries,
    findEntry,
    findEntries,
    getEntriesForDate,
    getEntriesForDateRange,
    getUnscheduledEntries,
    migrateOpenTasks,
  }
}

export type Bujo = ReturnType<typeof createBujo>
