import { describe, expect, it } from 'vitest'
import { UNSCHEDULED } from '../src'
import { dump, newBujo } from './helpers'

describe('entries', () => {
  it('adds an entry keyed by its date', async () => {
    const { db, bujo } = newBujo()
    const entry = await bujo.addEntry('2026-11-21', 'task', 'Call plumber')

    expect(entry._id.startsWith('2026-11-21:')).toBe(true)
    expect(entry).toMatchObject({ type: 'entry', date: '2026-11-21', status: 'task', body: 'Call plumber' })
    expect(entry._rev).toBeTruthy()
    expect((await dump(db)).entries).toHaveLength(1)
  })

  it('stamps userId on writes only when one is configured', async () => {
    const anonymous = newBujo()
    const plain = await anonymous.bujo.addEntry('2026-11-21', 'task', 'No user #t')
    expect(plain.userId).toBeUndefined()

    const owned = newBujo({ userId: 'me@example.com' })
    const mine = await owned.bujo.addEntry('2026-11-21', 'task', 'Mine #t')
    expect(mine.userId).toBe('me@example.com')
    const { tags } = await dump(owned.db)
    expect(tags[0]).toMatchObject({ userId: 'me@example.com' })
  })

  it('returns a single day including ghosts, oldest first', async () => {
    const { bujo } = newBujo()
    await bujo.addEntry('2026-11-20', 'task', 'yesterday')
    const a = await bujo.addEntry('2026-11-21', 'task', 'first')
    await bujo.addEntry('2026-11-21', 'note', 'second')
    await bujo.addEntry('2026-11-22', 'task', 'tomorrow')

    const day = await bujo.getEntriesForDate('2026-11-21')
    expect(day.map((d) => d.entry.body)).toEqual(['first', 'second'])

    await bujo.rescheduleEntry(a, '2026-11-25')
    const after = await bujo.getEntriesForDate('2026-11-21')
    expect(after.map((d) => [d.entry.body, d.isGhost])).toEqual([
      ['first', true],
      ['second', false],
    ])
  })

  it('returns an inclusive date range and leaves out unscheduled entries', async () => {
    const { bujo } = newBujo()
    await bujo.addEntry('2026-11-15', 'task', 'before')
    await bujo.addEntry('2026-11-16', 'task', 'mon')
    await bujo.addEntry('2026-11-22', 'task', 'sun')
    await bujo.addEntry('2026-11-23', 'task', 'after')
    await bujo.addEntry(UNSCHEDULED, 'task', 'someday')

    const week = await bujo.getEntriesForDateRange('2026-11-16', '2026-11-22')
    expect(week.map((d) => d.entry.body)).toEqual(['mon', 'sun'])

    const unscheduled = await bujo.getUnscheduledEntries()
    expect(unscheduled.map((e) => e.body)).toEqual(['someday'])
  })

  it('deletes an entry together with its ghosts', async () => {
    const { db, bujo } = newBujo()
    const entry = await bujo.addEntry('2026-11-19', 'task', 'wanderer')
    const moved = await bujo.rescheduleEntry(entry, '2026-11-20')
    const movedAgain = await bujo.rescheduleEntry(moved, '2026-11-21')
    expect((await dump(db)).ghosts).toHaveLength(2)

    await bujo.deleteEntry(movedAgain)
    const { entries, ghosts } = await dump(db)
    expect(entries).toHaveLength(0)
    expect(ghosts).toHaveLength(0)
  })
})
