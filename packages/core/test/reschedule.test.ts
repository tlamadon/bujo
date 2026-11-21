import { describe, expect, it } from 'vitest'
import { UNSCHEDULED, type BujoEntry, type GhostEntry } from '../src'
import { dump, newBujo } from './helpers'

describe('reschedule', () => {
  it('moves the entry, records history and leaves a ghost on the old day', async () => {
    const { db, bujo } = newBujo()
    const entry = await bujo.addEntry('2026-11-19', 'task', 'Call plumber #house')
    const moved = await bujo.rescheduleEntry(entry, '2026-11-21')

    expect(moved._id.startsWith('2026-11-21:')).toBe(true)
    expect(moved).toMatchObject({
      date: '2026-11-21',
      status: 'task',
      body: 'Call plumber #house',
      tags: ['house'],
      createdAt: entry.createdAt,
      dateHistory: ['2026-11-19'],
    })

    const { entries, ghosts } = await dump(db)
    expect(entries.map((e) => e._id)).toEqual([moved._id])
    expect(ghosts).toHaveLength(1)
    expect(ghosts[0]).toMatchObject({ type: 'ghost', date: '2026-11-19', ref: moved._id })
  })

  it('appends to dateHistory and repoints every ghost at the live entry', async () => {
    const { db, bujo } = newBujo()
    let entry = await bujo.addEntry('2026-11-17', 'task', 'slippery')
    for (const date of ['2026-11-18', '2026-11-19', '2026-11-20']) {
      entry = await bujo.rescheduleEntry(entry, date)
    }

    expect(entry.dateHistory).toEqual(['2026-11-17', '2026-11-18', '2026-11-19'])
    const { entries, ghosts } = await dump(db)
    expect(entries).toHaveLength(1)
    expect((ghosts as GhostEntry[]).map((g) => g.date).sort()).toEqual([
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
    ])
    for (const ghost of ghosts as GhostEntry[]) {
      expect(ghost.ref).toBe(entry._id)
      expect(await bujo.resolveGhost(ghost)).toMatchObject({ _id: entry._id })
    }
  })

  it('does not leave a ghost when leaving the unscheduled list', async () => {
    const { db, bujo } = newBujo()
    const entry = await bujo.addEntry(UNSCHEDULED, 'task', 'someday')
    const moved = await bujo.rescheduleEntry(entry, '2026-11-21')

    expect(moved.dateHistory).toEqual([UNSCHEDULED])
    expect((await dump(db)).ghosts).toHaveLength(0)
    expect(await bujo.getUnscheduledEntries()).toHaveLength(0)
  })

  it('leaves a ghost when a dated entry is sent to the unscheduled list', async () => {
    const { db, bujo } = newBujo()
    const entry = await bujo.addEntry('2026-11-21', 'task', 'not now')
    const moved = await bujo.rescheduleEntry(entry, UNSCHEDULED)

    expect(moved.date).toBe(UNSCHEDULED)
    const { ghosts } = await dump(db)
    expect(ghosts).toMatchObject([{ date: '2026-11-21', ref: moved._id }])
  })

  it('resolves a ghost to null once its entry is gone', async () => {
    const { db, bujo } = newBujo()
    const entry = await bujo.addEntry('2026-11-19', 'task', 'doomed')
    const moved = await bujo.rescheduleEntry(entry, '2026-11-20')
    const [ghost] = (await dump(db)).ghosts as GhostEntry[]

    await db.remove(moved._id, moved._rev!)
    expect(await bujo.resolveGhost(ghost)).toBeNull()
    expect(await bujo.getEntriesForDate('2026-11-19')).toEqual([])
  })
})

describe('migrate', () => {
  it('moves past open tasks to today and nothing else', async () => {
    const { db, bujo } = newBujo()
    await bujo.addEntry('2026-11-18', 'task', 'old open')
    await bujo.addEntry('2026-11-19', 'completed', 'old done')
    await bujo.addEntry('2026-11-19', 'note', 'old note')
    await bujo.addEntry('2026-11-19', 'event', 'old event')
    await bujo.addEntry('2026-11-21', 'task', 'today open')
    await bujo.addEntry('2026-11-25', 'task', 'future open')
    await bujo.addEntry(UNSCHEDULED, 'task', 'someday')

    expect(await bujo.migrateOpenTasks('2026-11-21')).toBe(1)

    const byBody = Object.fromEntries(
      ((await dump(db)).entries as BujoEntry[]).map((e) => [e.body, e]),
    )
    expect(byBody['old open']).toMatchObject({ date: '2026-11-21', dateHistory: ['2026-11-18'] })
    expect(byBody['old done'].date).toBe('2026-11-19')
    expect(byBody['old note'].date).toBe('2026-11-19')
    expect(byBody['old event'].date).toBe('2026-11-19')
    expect(byBody['future open'].date).toBe('2026-11-25')
    expect(byBody['someday'].date).toBe(UNSCHEDULED)

    const yesterday = await bujo.getEntriesForDate('2026-11-18')
    expect(yesterday.map((d) => [d.entry.body, d.isGhost])).toEqual([['old open', true]])
  })

  it('is a no-op when nothing is overdue', async () => {
    const { bujo } = newBujo()
    await bujo.addEntry('2026-11-21', 'task', 'today')
    expect(await bujo.migrateOpenTasks('2026-11-21')).toBe(0)
  })
})
