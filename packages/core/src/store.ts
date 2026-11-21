import { dateKind, isDayDate, isMonthKey, monthKey } from './dates'
import { AmbiguousError, InvalidError, NotFoundError, isConflict, isMissing } from './errors'
import { idTail, makeGhostId, makeId, refOf, withDate } from './ids'
import { DEFAULT_TAG_COLORS, makeTagId, parseTags } from './tags'
import {
  UNSCHEDULED,
  type AnyDoc,
  type BujoDb,
  type BujoEntry,
  type BujoOptions,
  type BujoStatus,
  type DbWriteResult,
  type DisplayEntry,
  type GhostEntry,
  type GoalState,
  type StoredDoc,
  type TagDoc,
} from './types'

/** How many times a write is retried after a revision conflict. */
const MAX_RETRIES = 5

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

/** Shortest text fragment accepted as an entry reference. */
const MIN_SUBSTRING = 3

/** Optional fields when creating an entry. */
export interface NewEntryFields {
  priority?: boolean
  /** `HH:MM`, events only */
  time?: string
}

/** Fields `updateEntry` can change. `null` clears an optional field. */
export interface EntryChanges {
  status?: BujoStatus
  body?: string
  priority?: boolean
  time?: string | null
  goalState?: GoalState | null
}

/** How to pick between several entries matching a body substring. */
export interface FindOptions {
  /**
   * Entries the caller is most likely after (e.g. open tasks for `done`).
   * A substring is matched against these first; the rest are only considered
   * when none of them match. Refs and ids are always matched exactly.
   */
  prefer?: (entry: BujoEntry) => boolean
}

/** Still to do: an open task, or a goal that is neither achieved nor dropped. */
export function isOpen(entry: BujoEntry): boolean {
  return entry.status === 'task' || (entry.status === 'goal' && !entry.goalState)
}

/** Finished one way or the other: completed, dropped, or a goal with an outcome. */
export function isClosed(entry: BujoEntry): boolean {
  return (
    entry.status === 'completed' ||
    entry.status === 'dropped' ||
    (entry.status === 'goal' && !!entry.goalState)
  )
}

/** How many times an entry has been rescheduled. */
export function movesOf(entry: BujoEntry): number {
  return entry.dateHistory?.length ?? 0
}

/** Goals live on a week or a month; everything else on a day, a month or nowhere yet. */
function checkPlacement(status: BujoStatus, date: string): void {
  const kind = dateKind(date)
  if (!kind) throw new InvalidError(`Invalid date "${date}"`)
  if (status === 'goal') {
    if (kind !== 'week' && kind !== 'month') {
      throw new InvalidError('A goal is dated by week (YYYY-Www) or month (YYYY-MM)')
    }
  } else if (kind === 'week') {
    throw new InvalidError('Only goals can be dated by week; use a day, a month (YYYY-MM) or unscheduled')
  }
}

function checkTime(time: string, status: BujoStatus): void {
  if (!TIME_RE.test(time)) throw new InvalidError(`Invalid time "${time}"; use 24h HH:MM`)
  if (status !== 'event') throw new InvalidError('Only events can have a time')
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

  async function rangeDocs(startkey: string | undefined, endkey: string): Promise<AnyDoc[]> {
    const result = await db.allDocs({
      include_docs: true,
      ...(startkey === undefined ? {} : { startkey }),
      endkey,
    })
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

  /** Fetch several documents in one round trip. Missing ones are left out. */
  async function getMany(ids: string[]): Promise<Map<string, AnyDoc>> {
    const found = new Map<string, AnyDoc>()
    const keys = [...new Set(ids)]
    if (keys.length === 0) return found
    const result = await db.allDocs({ include_docs: true, keys })
    for (const row of result.rows) {
      if (row.doc && !row.value?.deleted) found.set(row.id, row.doc as AnyDoc)
    }
    return found
  }

  /**
   * Find an entry that is no longer under `id` because it was moved: same
   * tail, different date prefix. `except` is an id to ignore.
   */
  async function findRelocated(id: string, except?: string): Promise<BujoEntry | null> {
    const suffix = `:${idTail(id)}`
    const result = await db.allDocs({})
    for (const row of result.rows) {
      if (row.id === id || row.id === except) continue
      if (!row.id.endsWith(suffix) || row.id.startsWith('ghost:')) continue
      const doc = await getOrNull(row.id)
      if (doc?.type === 'entry') return doc
    }
    return null
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
    const doc = await getOrNull(makeTagId(name))
    return doc?.type === 'tag' ? doc : null
  }

  async function getAllTags(): Promise<TagDoc[]> {
    const docs = await rangeDocs('tag:', 'tag:\ufff0')
    return docs.filter((d): d is TagDoc => d.type === 'tag')
  }

  async function setTagColor(name: string, color: string): Promise<void> {
    const id = makeTagId(name)
    const existing = await getTag(name)
    const doc: TagDoc = existing
      ? { ...existing, color }
      : { _id: id, type: 'tag', name: name.toLowerCase(), color }
    await putOver(stamp(doc), existing?._rev)
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

  /**
   * Create an entry. `date` is a day, a month key (future log), a week or
   * month key for a goal, or UNSCHEDULED.
   */
  async function addEntry(
    date: string,
    status: BujoStatus,
    body: string,
    fields: NewEntryFields = {},
  ): Promise<BujoEntry> {
    const text = body.trim()
    if (!text) throw new InvalidError('Entry text cannot be empty')
    checkPlacement(status, date)
    if (fields.time !== undefined) checkTime(fields.time, status)

    const tags = parseTags(text)
    if (tags.length > 0) await ensureTagDocs(tags)
    const createdAt = now()
    const entry: BujoEntry = stamp({
      _id: makeId(date, createdAt),
      type: 'entry',
      date,
      status,
      body: text,
      createdAt,
      ...(tags.length > 0 ? { tags } : {}),
      ...(fields.priority ? { priority: true } : {}),
      ...(fields.time !== undefined ? { time: fields.time } : {}),
    })
    const res = await db.put(entry)
    return { ...entry, _rev: res.rev }
  }

  /** Create a goal for a week (`YYYY-Www`) or a month (`YYYY-MM`). */
  function addGoal(period: string, body: string, fields: Pick<NewEntryFields, 'priority'> = {}): Promise<BujoEntry> {
    return addEntry(period, 'goal', body, fields)
  }

  /**
   * Apply `change` to an entry and store the result. `entry` may be stale:
   * on a revision conflict the change is re-applied to the latest stored
   * version — wherever that is, if the entry was moved in the meantime.
   * `change` returns null when there is nothing to do.
   */
  async function mutateEntry(
    entry: BujoEntry,
    change: (current: BujoEntry) => BujoEntry | null,
  ): Promise<BujoEntry> {
    let base = entry
    for (let attempt = 0; ; attempt++) {
      const next = change(base)
      if (!next) return base
      const tags = parseTags(next.body)
      if (tags.length > 0) {
        await ensureTagDocs(tags)
        next.tags = tags
      } else {
        delete next.tags
      }
      const doc = stamp(next)
      try {
        const res = await db.put(doc)
        return { ...doc, _rev: res.rev }
      } catch (err) {
        if (!isConflict(err) || attempt >= MAX_RETRIES) throw err
        const latest = (await getOrNull(base._id)) ?? (await findRelocated(base._id))
        if (!latest || latest.type !== 'entry') throw new NotFoundError('This entry no longer exists')
        base = latest
      }
    }
  }

  /** Change fields of an entry. To change its date, use `rescheduleEntry`. */
  function updateEntry(entry: BujoEntry, fields: EntryChanges): Promise<BujoEntry> {
    return mutateEntry(entry, (current) => {
      const next: BujoEntry = { ...current }

      if (fields.body !== undefined) {
        const text = fields.body.trim()
        if (!text) throw new InvalidError('Entry text cannot be empty')
        next.body = text
      }
      if (fields.status !== undefined && fields.status !== current.status) {
        if (fields.status === 'goal' || current.status === 'goal') {
          throw new InvalidError('A goal cannot be turned into another kind of entry, or back')
        }
        checkPlacement(fields.status, current.date)
        next.status = fields.status
      }
      if (fields.priority !== undefined) {
        if (fields.priority) next.priority = true
        else delete next.priority
      }
      if (fields.time !== undefined) {
        if (fields.time === null || fields.time === '') {
          delete next.time
        } else {
          checkTime(fields.time, next.status)
          next.time = fields.time
        }
      }
      if (fields.goalState !== undefined) {
        if (next.status !== 'goal') throw new InvalidError('Only goals have a goal state')
        if (fields.goalState === null) delete next.goalState
        else next.goalState = fields.goalState
      }
      return next
    })
  }

  function closeEntry(entry: BujoEntry, outcome: 'completed' | 'dropped'): Promise<BujoEntry> {
    return mutateEntry(entry, (current) => {
      if (current.status === 'goal') {
        const goalState: GoalState = outcome === 'completed' ? 'achieved' : 'dropped'
        return current.goalState === goalState ? null : { ...current, goalState }
      }
      if (current.status === outcome) return null
      const next: BujoEntry = { ...current, status: outcome }
      // Remember what a note or event was, so reopening restores it.
      if (!isClosed(current) && current.status !== 'task') next.prevStatus = current.status
      return next
    })
  }

  /** Mark an entry done (a goal: achieved). */
  function completeEntry(entry: BujoEntry): Promise<BujoEntry> {
    return closeEntry(entry, 'completed')
  }

  /** Mark an entry as no longer relevant. */
  function dropEntry(entry: BujoEntry): Promise<BujoEntry> {
    return closeEntry(entry, 'dropped')
  }

  /** Undo `completeEntry` / `dropEntry`. Does nothing to an entry that is not closed. */
  function reopenEntry(entry: BujoEntry): Promise<BujoEntry> {
    return mutateEntry(entry, (current) => {
      if (!isClosed(current)) return null
      const next: BujoEntry = { ...current }
      if (current.status === 'goal') {
        delete next.goalState
      } else {
        next.status = current.prevStatus ?? 'task'
        delete next.prevStatus
      }
      return next
    })
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
        if (!latest) {
          // Gone from here. If it was moved rather than deleted, delete it there.
          const relocated = await findRelocated(entry._id)
          if (relocated) await deleteEntry(relocated)
          return
        }
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
   * - a ghost is left on the old date if it was a day (so it shows as ">" there)
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
    checkPlacement(entry.status, newDate)
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
        if (!latest || latest.type !== 'entry') {
          // Already gone. If someone moved it elsewhere meanwhile, the copy
          // just written is a duplicate of that one: move that one here instead.
          const relocated = await findRelocated(oldId, newId)
          if (relocated) return rescheduleEntry(relocated, newDate)
          return { ...moved, _rev: newRev }
        }
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
      // Leave a ghost on the day the entry is leaving. Months, weeks and the
      // unscheduled list are not days: nothing to haunt there.
      if (isDayDate(oldDate) && !haunted.has(oldDate)) {
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

  /** Resolve a ghost to its parent entry, or null if parent was deleted */
  async function resolveGhost(ghost: GhostEntry): Promise<BujoEntry | null> {
    const doc = await getOrNull(ghost.ref)
    return doc?.type === 'entry' ? doc : null
  }

  /**
   * Entries on the days within [startDate, endDate], plus the ghosts left on
   * those days by entries that moved away. Oldest first.
   *
   * Week- and month-dated entries (goals, future log) are not part of any
   * day: get those with `getEntriesForPeriod`.
   */
  async function getEntriesForDateRange(startDate: string, endDate: string): Promise<DisplayEntry[]> {
    // Real entries by _id prefix range. Month keys sort between the days of
    // neighbouring months, so a range spanning two months picks some up.
    const docs = await rangeDocs(`${startDate}:`, `${endDate}:\ufff0`)
    const entries: DisplayEntry[] = docs
      .filter((d): d is BujoEntry => d.type === 'entry' && isDayDate(d.date))
      .map((entry) => ({ entry, isGhost: false }))

    // Ghosts in the range, resolved to the entries they stand for
    const ghostDocs = await rangeDocs(`ghost:${startDate}:`, `ghost:${endDate}:\ufff0`)
    const ghosts = ghostDocs.filter((d): d is GhostEntry => d.type === 'ghost' && isDayDate(d.date))
    const parents = await getMany(ghosts.map((g) => g.ref))
    for (const ghost of ghosts) {
      const parent = parents.get(ghost.ref)
      // A ghost on the day its entry currently sits on says nothing: skip it.
      if (parent?.type === 'entry' && parent.date !== ghost.date) {
        entries.push({ entry: parent, isGhost: true, ghostDoc: ghost })
      }
    }

    entries.sort((a, b) => a.entry.createdAt - b.entry.createdAt)
    return entries
  }

  function getEntriesForDate(date: string): Promise<DisplayEntry[]> {
    return getEntriesForDateRange(date, date)
  }

  /**
   * Entries dated to exactly this value: a week key or month key (goals and,
   * for months, future log items), a day (without ghosts), or UNSCHEDULED.
   * Oldest first.
   */
  async function getEntriesForPeriod(period: string): Promise<BujoEntry[]> {
    const docs = await rangeDocs(`${period}:`, `${period}:\ufff0`)
    return docs
      .filter((d): d is BujoEntry => d.type === 'entry' && d.date === period)
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  /** The goals of a week (`YYYY-Www`) or month (`YYYY-MM`), oldest first. */
  async function getGoals(period: string): Promise<BujoEntry[]> {
    const entries = await getEntriesForPeriod(period)
    return entries.filter((e) => e.status === 'goal')
  }

  function getUnscheduledEntries(): Promise<BujoEntry[]> {
    return getEntriesForPeriod(UNSCHEDULED)
  }

  /** Future log items: non-goal entries dated to a month rather than a day. */
  async function getMonthScheduledEntries(): Promise<BujoEntry[]> {
    const entries = await getAllEntries()
    return entries.filter((e) => e.status !== 'goal' && isMonthKey(e.date))
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

    // 3. Body substring, preferred entries first. Too short a fragment would
    // "uniquely" match whatever happens to be the only open task: refuse it.
    if (q.length < MIN_SUBSTRING) {
      throw new NotFoundError(
        `No entry has the ref "${q}" (text matches need at least ${MIN_SUBSTRING} characters)`,
      )
    }
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

  /**
   * Open tasks whose date has passed: a day before `today`, or a month
   * before the current one. Oldest date first.
   */
  async function getOverdueTasks(today: string): Promise<BujoEntry[]> {
    // Everything that sorts before today's first id: all earlier days, and
    // the month keys of all earlier months.
    const docs = await rangeDocs(undefined, `${today}:`)
    const thisMonth = monthKey(today)
    return docs
      .filter((d): d is BujoEntry => {
        if (d.type !== 'entry' || d.status !== 'task') return false
        if (isDayDate(d.date)) return d.date < today
        return isMonthKey(d.date) && d.date < thisMonth
      })
      .sort((a, b) => (a.date === b.date ? a.createdAt - b.createdAt : a.date < b.date ? -1 : 1))
  }

  /** Move every overdue open task onto `today`. Returns the moved entries. */
  async function migrateOpenTasks(today: string): Promise<BujoEntry[]> {
    if (!isDayDate(today)) throw new InvalidError(`Invalid date "${today}"`)
    const overdue = await getOverdueTasks(today)
    const moved: BujoEntry[] = []
    for (const entry of overdue) {
      moved.push(await rescheduleEntry(entry, today))
    }
    return moved
  }

  /** Open tasks rescheduled at least `minMoves` times, most-moved first. */
  async function getStaleTasks(minMoves = 3): Promise<BujoEntry[]> {
    const entries = await getAllEntries()
    return entries
      .filter((e) => e.status === 'task' && movesOf(e) >= minMoves)
      .sort((a, b) => movesOf(b) - movesOf(a) || a.createdAt - b.createdAt)
  }

  return {
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
    getGhostsOf,
    getAllEntries,
    findEntry,
    findEntries,
    getEntriesForDate,
    getEntriesForDateRange,
    getEntriesForPeriod,
    getGoals,
    getUnscheduledEntries,
    getMonthScheduledEntries,
    getOverdueTasks,
    migrateOpenTasks,
    getStaleTasks,
  }
}

export type Bujo = ReturnType<typeof createBujo>
