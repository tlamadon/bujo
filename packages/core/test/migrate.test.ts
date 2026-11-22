import { describe, expect, it } from 'vitest'
import { UNSCHEDULED, refOf, type BujoEntry } from '../src'
import { dump, newBujo } from './helpers'

const TODAY = '2026-11-21'

async function byBody(db: Parameters<typeof dump>[0]) {
  const { entries } = await dump(db)
  return Object.fromEntries((entries as BujoEntry[]).map((e) => [e.body, e]))
}

describe('migrate', () => {
  it('moves past open tasks to today and nothing else', async () => {
    const { db, bujo } = newBujo()
    await bujo.addEntry('2026-11-18', 'task', 'old open')
    await bujo.addEntry('2026-11-19', 'completed', 'old done')
    await bujo.addEntry('2026-11-19', 'dropped', 'old dropped')
    await bujo.addEntry('2026-11-19', 'note', 'old note')
    await bujo.addEntry('2026-11-19', 'event', 'old event')
    await bujo.addEntry(TODAY, 'task', 'today open')
    await bujo.addEntry('2026-11-25', 'task', 'future open')
    await bujo.addEntry(UNSCHEDULED, 'task', 'someday')

    const moved = await bujo.migrateOpenTasks(TODAY)
    expect(moved.map((e) => e.body)).toEqual(['old open'])

    const entries = await byBody(db)
    expect(entries['old open']).toMatchObject({ date: TODAY, dateHistory: ['2026-11-18'] })
    for (const untouched of ['old done', 'old dropped', 'old note', 'old event']) {
      expect(entries[untouched].date, untouched).toBe('2026-11-19')
    }
    expect(entries['future open'].date).toBe('2026-11-25')
    expect(entries['someday'].date).toBe(UNSCHEDULED)

    const ghostDay = await bujo.getEntriesForDate('2026-11-18')
    expect(ghostDay.map((d) => [d.entry.body, d.isGhost])).toEqual([['old open', true]])
  })

  it('keeps refs stable and counts the move', async () => {
    const { bujo } = newBujo()
    const entry = await bujo.addEntry('2026-11-18', 'task', 'old open')
    const [moved] = await bujo.migrateOpenTasks(TODAY)
    expect(refOf(moved._id)).toBe(refOf(entry._id))
    expect(moved.dateHistory).toHaveLength(1)
  })

  it('is a no-op when nothing is overdue, and when run twice', async () => {
    const { bujo } = newBujo()
    await bujo.addEntry('2026-11-20', 'task', 'yesterday')
    expect(await bujo.migrateOpenTasks(TODAY)).toHaveLength(1)
    expect(await bujo.migrateOpenTasks(TODAY)).toEqual([])
    expect(await bujo.getOverdueTasks(TODAY)).toEqual([])
  })

  it('carries a month task into the current month, once its month is over', async () => {
    const { db, bujo } = newBujo()
    await bujo.addEntry('2026-10', 'task', 'sometime in October')
    await bujo.addEntry('2026-11', 'task', 'sometime in November')
    await bujo.addEntry('2026-12', 'task', 'sometime in December')

    const overdue = await bujo.getOverdueTasks(TODAY)
    expect(overdue.map((e) => e.body)).toEqual(['sometime in October'])

    await bujo.migrateOpenTasks(TODAY)
    const entries = await byBody(db)
    // It stays a month task: "some time in October" becomes "some time in November"
    expect(entries['sometime in October']).toMatchObject({ date: '2026-11', dateHistory: ['2026-10'] })
    expect(entries['sometime in November'].date).toBe('2026-11')
    expect(entries['sometime in December'].date).toBe('2026-12')
    // Leaving a month is not leaving a day: no ghost
    expect((await dump(db)).ghosts).toHaveLength(0)
  })

  it('carries a week task into the current week, once its week is over', async () => {
    const { db, bujo } = newBujo()
    // TODAY is in 2026-W47
    await bujo.addEntry('2026-W40', 'task', 'old week')
    await bujo.addEntry('2025-W50', 'task', 'last year')
    await bujo.addEntry('2026-W47', 'task', 'this week')
    await bujo.addEntry('2026-W48', 'task', 'next week')
    const done = await bujo.addEntry('2026-W40', 'task', 'old week, done')
    await bujo.completeEntry(done)

    const moved = await bujo.migrateOpenTasks(TODAY)
    expect(moved.map((e) => e.body)).toEqual(['last year', 'old week'])

    const entries = await byBody(db)
    expect(entries['old week']).toMatchObject({ date: '2026-W47', dateHistory: ['2026-W40'] })
    expect(entries['last year'].date).toBe('2026-W47')
    expect(entries['this week'].date).toBe('2026-W47')
    expect(entries['next week'].date).toBe('2026-W48')
    expect(entries['old week, done'].date).toBe('2026-W40')
    expect((await dump(db)).ghosts).toHaveLength(0)
  })

  it('across a year boundary, goes by the ISO week', async () => {
    const { db, bujo } = newBujo()
    // 2027-01-02 is a Saturday in ISO week 2026-W53
    await bujo.addEntry('2026-W53', 'task', 'still this week')
    await bujo.addEntry('2026-W52', 'task', 'the week before')
    await bujo.migrateOpenTasks('2027-01-02')
    const entries = await byBody(db)
    expect(entries['still this week'].date).toBe('2026-W53')
    expect(entries['the week before'].date).toBe('2026-W53')
  })

  it('lists overdue tasks oldest first', async () => {
    const { bujo } = newBujo()
    await bujo.addEntry('2026-11-20', 'task', 'c')
    await bujo.addEntry('2026-11-03', 'task', 'a')
    await bujo.addEntry('2026-11-10', 'task', 'b')
    expect((await bujo.getOverdueTasks(TODAY)).map((e) => e.body)).toEqual(['a', 'b', 'c'])
  })
})

describe('stale tasks', () => {
  it('lists open tasks moved at least N times, most-moved first', async () => {
    const { bujo } = newBujo()
    const move = async (entry: BujoEntry, times: number) => {
      let current = entry
      for (let i = 1; i <= times; i++) {
        current = await bujo.rescheduleEntry(current, `2026-11-${String(i + 1).padStart(2, '0')}`)
      }
      return current
    }
    await move(await bujo.addEntry('2026-11-01', 'task', 'moved 4x'), 4)
    await move(await bujo.addEntry('2026-11-01', 'task', 'moved 3x'), 3)
    await move(await bujo.addEntry('2026-11-01', 'task', 'moved 2x'), 2)
    const done = await move(await bujo.addEntry('2026-11-01', 'task', 'moved 5x but done'), 5)
    await bujo.completeEntry(done)

    expect((await bujo.getStaleTasks()).map((e) => e.body)).toEqual(['moved 4x', 'moved 3x'])
    expect((await bujo.getStaleTasks(2)).map((e) => e.body)).toEqual(['moved 4x', 'moved 3x', 'moved 2x'])
    expect(await bujo.getStaleTasks(5)).toEqual([])
  })
})
