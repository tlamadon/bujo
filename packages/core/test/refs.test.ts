import { describe, expect, it } from 'vitest'
import {
  AmbiguousError,
  NotFoundError,
  UNSCHEDULED,
  idTail,
  makeId,
  makeUid,
  refOf,
  withDate,
  type BujoEntry,
  type GhostEntry,
} from '../src'
import { dump, newBujo } from './helpers'

describe('ids', () => {
  it('builds ids as date:createdAt:uid with a 6-char base36 uid', () => {
    const id = makeId('2026-11-21', 1795277772947)
    expect(id).toMatch(/^2026-11-21:1795277772947:[0-9a-z]{6}$/)
    for (let i = 0; i < 200; i++) expect(makeUid()).toMatch(/^[0-9a-z]{6}$/)
  })

  it('splits an id into a movable date prefix and a stable tail', () => {
    const id = '2026-11-21:1795277772947:tg4odp'
    expect(idTail(id)).toBe('1795277772947:tg4odp')
    expect(refOf(id)).toBe('tg4odp')
    expect(withDate(id, '2026-12-01')).toBe('2026-12-01:1795277772947:tg4odp')
    expect(withDate(id, UNSCHEDULED)).toBe('~unscheduled:1795277772947:tg4odp')
  })
})

describe('stable refs', () => {
  it('keeps the same ref and tail across any number of moves', async () => {
    const { bujo } = newBujo()
    const original = await bujo.addEntry('2026-11-17', 'task', 'Renew passport')
    const ref = refOf(original._id)
    const tail = idTail(original._id)

    let entry = original
    for (const date of ['2026-11-18', UNSCHEDULED, '2026-12-01', '2026-11-18']) {
      entry = await bujo.rescheduleEntry(entry, date)
      expect(entry._id).toBe(`${date}:${tail}`)
      expect(refOf(entry._id)).toBe(ref)
      expect((await bujo.findEntry(ref))._id).toBe(entry._id)
    }
    expect(entry.dateHistory).toEqual(['2026-11-17', '2026-11-18', UNSCHEDULED, '2026-12-01'])
    expect(await bujo.getAllEntries()).toHaveLength(1)
  })

  it('resolves an out-of-date full id through its tail', async () => {
    const { bujo } = newBujo()
    const original = await bujo.addEntry('2026-11-19', 'task', 'Book flights')
    const moved = await bujo.rescheduleEntry(original, '2026-11-25')

    expect((await bujo.findEntry(original._id))._id).toBe(moved._id)
    expect((await bujo.findEntry(moved._id))._id).toBe(moved._id)
  })

  it('is a no-op when the entry is already on the target date', async () => {
    const { db, bujo } = newBujo()
    const entry = await bujo.addEntry('2026-11-21', 'task', 'stay put')
    const same = await bujo.rescheduleEntry(entry, '2026-11-21')

    expect(same).toEqual(entry)
    expect(same.dateHistory).toBeUndefined()
    expect((await dump(db)).ghosts).toHaveLength(0)
  })

  it('carries every field of the entry over a move', async () => {
    const { db, bujo } = newBujo({ userId: 'me@example.com' })
    const entry = await bujo.addEntry('2026-11-19', 'event', 'Dentist #health')
    // A field core does not know about must survive too
    await db.put({ ...entry, extra: 'kept' } as BujoEntry)
    const stored = (await db.get(entry._id)) as BujoEntry

    const moved = await bujo.rescheduleEntry(stored, '2026-11-20')
    expect(moved).toMatchObject({
      status: 'event',
      body: 'Dentist #health',
      tags: ['health'],
      userId: 'me@example.com',
      createdAt: entry.createdAt,
      extra: 'kept',
    })
  })
})

describe('ghosts with stable ids', () => {
  it('keeps one ghost per day and none on the day the entry is on', async () => {
    const { db, bujo } = newBujo()
    const a = await bujo.addEntry('2026-11-19', 'task', 'ping pong')
    const b = await bujo.rescheduleEntry(a, '2026-11-20')
    const backOnA = await bujo.rescheduleEntry(b, '2026-11-19')

    // Back where it started: a ghost only where it is not
    let ghosts = (await dump(db)).ghosts as GhostEntry[]
    expect(ghosts.map((g) => g.date)).toEqual(['2026-11-20'])
    expect(ghosts[0].ref).toBe(backOnA._id)

    // Leaving the first day a second time reuses that day's ghost id
    const backOnB = await bujo.rescheduleEntry(backOnA, '2026-11-20')
    ghosts = (await dump(db)).ghosts as GhostEntry[]
    expect(ghosts.map((g) => g.date)).toEqual(['2026-11-19'])
    expect(ghosts[0].ref).toBe(backOnB._id)

    const third = await bujo.rescheduleEntry(backOnB, '2026-11-21')
    ghosts = (await dump(db)).ghosts as GhostEntry[]
    expect(ghosts.map((g) => g.date)).toEqual(['2026-11-19', '2026-11-20'])
    expect(new Set(ghosts.map((g) => g.ref))).toEqual(new Set([third._id]))
    expect(third.dateHistory).toEqual(['2026-11-19', '2026-11-20', '2026-11-19', '2026-11-20'])
    expect(await bujo.getAllEntries()).toHaveLength(1)
  })

  it('understands ghosts written by the previous id scheme', async () => {
    const { db, bujo } = newBujo()
    // An entry that was rescheduled twice by the old code: its id changed
    // completely each time, and ghost ids embed whatever id it had back then.
    const legacy: BujoEntry = {
      _id: '2026-11-21:1795277804374:tntw5s',
      type: 'entry',
      date: '2026-11-21',
      status: 'task',
      body: 'Legacy task',
      createdAt: 1795277700000,
      dateHistory: ['2026-11-19', '2026-11-20'],
    }
    await db.bulkDocs([
      legacy,
      { _id: 'ghost:2026-11-19:2026-11-20:1795277788944:7vaedg', type: 'ghost', date: '2026-11-19', ref: legacy._id },
      { _id: 'ghost:2026-11-20:2026-11-21:1795277804374:tntw5s', type: 'ghost', date: '2026-11-20', ref: legacy._id },
      // The old code could leave a ghost on the entry's own day; it must stay hidden
      { _id: 'ghost:2026-11-21:2026-11-21:1795277700001:zzzzzz', type: 'ghost', date: '2026-11-21', ref: legacy._id },
    ])

    const today = await bujo.getEntriesForDate('2026-11-21')
    expect(today.map((d) => d.isGhost)).toEqual([false])

    const stored = await bujo.findEntry('tntw5s')
    const moved = await bujo.rescheduleEntry(stored, '2026-11-22')
    expect(moved._id).toBe('2026-11-22:1795277804374:tntw5s')

    const ghosts = (await dump(db)).ghosts as GhostEntry[]
    expect(ghosts.map((g) => g.date)).toEqual(['2026-11-19', '2026-11-20', '2026-11-21'])
    expect(new Set(ghosts.map((g) => g.ref))).toEqual(new Set([moved._id]))
    for (const date of ['2026-11-19', '2026-11-20', '2026-11-21']) {
      const day = await bujo.getEntriesForDate(date)
      expect(day.map((d) => [d.entry._id, d.isGhost])).toEqual([[moved._id, true]])
    }
  })
})

describe('concurrent writers', () => {
  it('re-applies an update when the caller holds a stale revision', async () => {
    const { bujo } = newBujo()
    const entry = await bujo.addEntry('2026-11-21', 'task', 'Draft report')
    await bujo.updateEntry(entry, { body: 'Draft report #work' }) // someone else edits

    const done = await bujo.updateEntry(entry, { status: 'completed' }) // stale _rev
    expect(done).toMatchObject({ status: 'completed', body: 'Draft report #work', tags: ['work'] })
  })

  it('moves the latest version when the entry changed since it was read', async () => {
    const { db, bujo } = newBujo()
    const entry = await bujo.addEntry('2026-11-20', 'task', 'Draft report')
    await bujo.updateEntry(entry, { body: 'Draft final report' })

    const moved = await bujo.rescheduleEntry(entry, '2026-11-21') // stale _rev
    expect(moved).toMatchObject({ body: 'Draft final report', dateHistory: ['2026-11-20'] })
    const { entries, ghosts } = await dump(db)
    expect(entries.map((e) => e._id)).toEqual([moved._id])
    expect(ghosts).toHaveLength(1)
  })

  it('makes the same move from two clients converge on one entry', async () => {
    const { db, bujo } = newBujo()
    const entry = await bujo.addEntry('2026-11-20', 'task', 'Migrated twice')

    const first = await bujo.rescheduleEntry(entry, '2026-11-21')
    const second = await bujo.rescheduleEntry(entry, '2026-11-21') // same stale input
    expect(second._id).toBe(first._id)

    const { entries, ghosts } = await dump(db)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ dateHistory: ['2026-11-20'] })
    expect(ghosts).toHaveLength(1)
  })

  it('follows an entry that was moved since the caller read it', async () => {
    const { db, bujo } = newBujo()
    const stale = await bujo.addEntry('2026-11-20', 'task', 'Moved elsewhere')
    const moved = await bujo.rescheduleEntry(stale, '2026-11-21') // another client

    const done = await bujo.completeEntry(stale)
    expect(done).toMatchObject({ _id: moved._id, status: 'completed', dateHistory: ['2026-11-20'] })

    const edited = await bujo.updateEntry(stale, { body: 'Moved and edited' })
    expect(edited).toMatchObject({ _id: moved._id, status: 'completed', body: 'Moved and edited' })
    expect((await dump(db)).entries).toHaveLength(1)
  })

  it('does not duplicate an entry that two clients move to different days', async () => {
    const { db, bujo } = newBujo()
    const stale = await bujo.addEntry('2026-11-20', 'task', 'Tug of war')
    await bujo.rescheduleEntry(stale, '2026-11-21') // client 1
    const final = await bujo.rescheduleEntry(stale, '2026-11-25') // client 2, stale copy

    const { entries, ghosts } = await dump(db)
    expect(entries.map((e) => e._id)).toEqual([final._id])
    expect(final).toMatchObject({ date: '2026-11-25', dateHistory: ['2026-11-20', '2026-11-21'] })
    expect((ghosts as GhostEntry[]).map((g) => [g.date, g.ref])).toEqual([
      ['2026-11-20', final._id],
      ['2026-11-21', final._id],
    ])
  })

  it('reports an entry that was deleted instead of resurrecting it', async () => {
    const { db, bujo } = newBujo()
    const stale = await bujo.addEntry('2026-11-21', 'task', 'Deleted elsewhere')
    await bujo.deleteEntry(stale)

    await expect(bujo.completeEntry(stale)).rejects.toBeInstanceOf(NotFoundError)
    expect((await dump(db)).entries).toHaveLength(0)
  })

  it('deletes a moved entry where it now lives', async () => {
    const { db, bujo } = newBujo()
    const stale = await bujo.addEntry('2026-11-20', 'task', 'Moved then deleted')
    await bujo.rescheduleEntry(stale, '2026-11-21')

    await bujo.deleteEntry(stale)
    const { entries, ghosts } = await dump(db)
    expect(entries).toHaveLength(0)
    expect(ghosts).toHaveLength(0)
  })

  it('deletes an entry even when the caller holds a stale revision', async () => {
    const { db, bujo } = newBujo()
    const entry = await bujo.addEntry('2026-11-21', 'task', 'short lived')
    await bujo.updateEntry(entry, { status: 'completed' })

    await bujo.deleteEntry(entry)
    expect((await dump(db)).entries).toHaveLength(0)
    await expect(bujo.deleteEntry(entry)).resolves.toBeUndefined() // already gone
  })
})

describe('finding entries', () => {
  async function seed() {
    const ctx = newBujo()
    const plumber = await ctx.bujo.addEntry('2026-11-21', 'task', 'Call plumber #house')
    const callMum = await ctx.bujo.addEntry('2026-11-21', 'task', 'Call mum')
    const oldCall = await ctx.bujo.addEntry('2026-11-10', 'completed', 'Call bank')
    const note = await ctx.bujo.addEntry('2026-11-21', 'note', 'Meeting at 10:30 went well')
    return { ...ctx, plumber, callMum, oldCall, note }
  }

  it('finds by short ref, case-insensitively', async () => {
    const { bujo, plumber } = await seed()
    const ref = refOf(plumber._id)
    expect((await bujo.findEntry(ref))._id).toBe(plumber._id)
    expect((await bujo.findEntry(ref.toUpperCase()))._id).toBe(plumber._id)
    expect((await bujo.findEntry(`  ${ref} `))._id).toBe(plumber._id)
  })

  it('finds by a unique body substring, case-insensitively', async () => {
    const { bujo, plumber, note } = await seed()
    expect((await bujo.findEntry('PLUMB'))._id).toBe(plumber._id)
    // A substring containing ":" is not mistaken for an id
    expect((await bujo.findEntry('10:30'))._id).toBe(note._id)
  })

  it('reports ambiguous substrings with the candidates', async () => {
    const { bujo, plumber, callMum, oldCall } = await seed()
    const err = await bujo.findEntry('call').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AmbiguousError)
    expect((err as AmbiguousError).code).toBe('ambiguous')
    expect((err as AmbiguousError).candidates.map((e) => e._id).sort()).toEqual(
      [plumber._id, callMum._id, oldCall._id].sort(),
    )
  })

  it('narrows a substring to preferred entries before giving up', async () => {
    const { bujo, plumber, callMum, oldCall } = await seed()
    const open = (e: BujoEntry) => e.status === 'task'
    const closed = (e: BujoEntry) => e.status === 'completed'

    // Only one *closed* entry says "call"
    expect((await bujo.findEntry('call', { prefer: closed }))._id).toBe(oldCall._id)
    // Two open ones do: still ambiguous, but only among those two
    const err = await bujo.findEntry('call', { prefer: open }).catch((e: unknown) => e)
    expect((err as AmbiguousError).candidates.map((e) => e._id).sort()).toEqual(
      [plumber._id, callMum._id].sort(),
    )
    // Nothing preferred matches: fall back to everything
    expect((await bujo.findEntry('bank', { prefer: open }))._id).toBe(oldCall._id)
  })

  it('reports duplicate refs as ambiguous and still accepts the full id', async () => {
    const { db, bujo } = newBujo()
    const twins: BujoEntry[] = ['2026-11-20:1795000000001:abc123', '2026-11-21:1795000000002:abc123'].map(
      (_id, i) => ({ _id, type: 'entry', date: _id.slice(0, 10), status: 'task', body: `twin ${i}`, createdAt: i }),
    )
    await db.bulkDocs(twins)

    await expect(bujo.findEntry('abc123')).rejects.toBeInstanceOf(AmbiguousError)
    expect((await bujo.findEntry(twins[1]._id)).body).toBe('twin 1')
  })

  it('throws NotFoundError when nothing matches', async () => {
    const { bujo } = await seed()
    await expect(bujo.findEntry('zzzzzz')).rejects.toBeInstanceOf(NotFoundError)
    await expect(bujo.findEntry('2020-01-01:1:nope00')).rejects.toBeInstanceOf(NotFoundError)
    await expect(bujo.findEntry('   ')).rejects.toMatchObject({ code: 'invalid' })
  })

  it('resolves several references at once, all or nothing', async () => {
    const { bujo, plumber, callMum } = await seed()
    const found = await bujo.findEntries([refOf(plumber._id), 'mum'])
    expect(found.map((e) => e._id)).toEqual([plumber._id, callMum._id])
    await expect(bujo.findEntries([refOf(plumber._id), 'nope'])).rejects.toBeInstanceOf(NotFoundError)
  })
})
