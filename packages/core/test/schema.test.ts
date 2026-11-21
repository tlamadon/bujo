import { describe, expect, it } from 'vitest'
import { InvalidError, UNSCHEDULED, isClosed, isOpen, type BujoEntry, type GhostEntry } from '../src'
import { dump, newBujo } from './helpers'

describe('goals and period keys', () => {
  it('stores a goal under its week or month key', async () => {
    const { bujo } = newBujo()
    const weekly = await bujo.addGoal('2026-W47', 'Ship the CLI #bujo')
    const monthly = await bujo.addGoal('2026-11', 'Run 60 km')

    expect(weekly).toMatchObject({ status: 'goal', date: '2026-W47', tags: ['bujo'] })
    expect(weekly._id.startsWith('2026-W47:')).toBe(true)
    expect(monthly._id.startsWith('2026-11:')).toBe(true)
    expect(weekly.goalState).toBeUndefined()
    expect(isOpen(weekly)).toBe(true)
  })

  it('returns the goals of one period with a prefix query', async () => {
    const { bujo } = newBujo()
    await bujo.addGoal('2026-W46', 'last week')
    await bujo.addGoal('2026-W47', 'this week A')
    await bujo.addGoal('2026-W47', 'this week B')
    await bujo.addGoal('2026-W48', 'next week')
    await bujo.addGoal('2026-11', 'this month')
    await bujo.addGoal('2026-12', 'next month')
    await bujo.addEntry('2026-11', 'task', 'future log item, not a goal')
    await bujo.addEntry('2026-11-21', 'task', 'a day in that week and month')

    expect((await bujo.getGoals('2026-W47')).map((g) => g.body)).toEqual(['this week A', 'this week B'])
    expect((await bujo.getGoals('2026-11')).map((g) => g.body)).toEqual(['this month'])
    expect(await bujo.getGoals('2026-W49')).toEqual([])
    expect((await bujo.getEntriesForPeriod('2026-11')).map((e) => e.body)).toEqual([
      'this month',
      'future log item, not a goal',
    ])
  })

  it('sorts period keys next to the days they cover', async () => {
    const { db, bujo } = newBujo()
    for (const [date, status] of [
      ['2026-W47', 'goal'], ['2026-11', 'goal'], ['2026-12', 'goal'], ['2026-W01', 'goal'], ['2027-W01', 'goal'],
      ['2026-11-01', 'task'], ['2026-11-30', 'task'], ['2026-12-01', 'task'], ['2027-01-01', 'task'],
      [UNSCHEDULED, 'task'],
    ] as const) {
      await bujo.addEntry(date, status, `${status} ${date}`)
    }
    // Within a year: each month's days, then that month; then the year's weeks.
    expect((await dump(db)).entries.map((e) => (e as BujoEntry).date)).toEqual([
      '2026-11-01', '2026-11-30', '2026-11',
      '2026-12-01', '2026-12',
      '2026-W01', '2026-W47',
      '2027-01-01', '2027-W01',
      UNSCHEDULED,
    ])
  })

  it('keeps goals and future-log items out of day ranges', async () => {
    const { bujo } = newBujo()
    await bujo.addGoal('2026-11', 'November goal')
    await bujo.addGoal('2026-W49', 'Week 49 goal')
    await bujo.addGoal('2026-W53', 'Last week of the year')
    await bujo.addEntry('2026-11', 'task', 'sometime in November')
    await bujo.addEntry('2026-11-30', 'task', 'monday')
    await bujo.addEntry('2026-12-06', 'task', 'sunday')
    await bujo.addEntry('2026-12-31', 'task', 'new year eve')

    // A week spanning two months: the month key sorts inside this id range
    const week = await bujo.getEntriesForDateRange('2026-11-30', '2026-12-06')
    expect(week.map((d) => d.entry.body)).toEqual(['monday', 'sunday'])
    // A week spanning two years: every week key of 2026 sorts inside this one
    const newYear = await bujo.getEntriesForDateRange('2026-12-28', '2027-01-03')
    expect(newYear.map((d) => d.entry.body)).toEqual(['new year eve'])
    expect((await bujo.getEntriesForDate('2026-11-30')).map((d) => d.entry.body)).toEqual(['monday'])
  })

  it('tracks goal outcome in goalState, leaving status alone', async () => {
    const { bujo } = newBujo()
    const goal = await bujo.addGoal('2026-W47', 'Ship it')

    const achieved = await bujo.completeEntry(goal)
    expect(achieved).toMatchObject({ status: 'goal', goalState: 'achieved' })
    expect(isClosed(achieved)).toBe(true)

    const dropped = await bujo.dropEntry(achieved)
    expect(dropped).toMatchObject({ status: 'goal', goalState: 'dropped' })

    const reopened = await bujo.reopenEntry(dropped)
    expect(reopened.status).toBe('goal')
    expect(reopened.goalState).toBeUndefined()
    expect(isOpen(reopened)).toBe(true)
  })

  it('moves a goal to another period, keeping its ref and leaving no ghost', async () => {
    const { db, bujo } = newBujo()
    const goal = await bujo.addGoal('2026-W47', 'Slipped a week')
    const moved = await bujo.rescheduleEntry(goal, '2026-W48')

    expect(moved._id).toBe(goal._id.replace('2026-W47', '2026-W48'))
    expect(moved.dateHistory).toEqual(['2026-W47'])
    expect((await dump(db)).ghosts).toHaveLength(0)
    expect(await bujo.getGoals('2026-W47')).toEqual([])

    const monthly = await bujo.rescheduleEntry(moved, '2026-12')
    expect(monthly.date).toBe('2026-12')
  })

  it('only allows goals on weeks and months, and only goals on weeks', async () => {
    const { bujo } = newBujo()
    await expect(bujo.addGoal('2026-11-21', 'daily goal')).rejects.toBeInstanceOf(InvalidError)
    await expect(bujo.addGoal(UNSCHEDULED, 'floating goal')).rejects.toBeInstanceOf(InvalidError)
    await expect(bujo.addGoal('2026-W54', 'no such week')).rejects.toBeInstanceOf(InvalidError)
    await expect(bujo.addEntry('2026-W47', 'task', 'weekly task')).rejects.toThrow(/Only goals/)
    await expect(bujo.addEntry('not-a-date', 'task', 'x')).rejects.toThrow(/Invalid date/)
    await expect(bujo.addEntry('', 'task', 'x')).rejects.toBeInstanceOf(InvalidError)

    const goal = await bujo.addGoal('2026-W47', 'goal')
    await expect(bujo.rescheduleEntry(goal, '2026-11-25')).rejects.toBeInstanceOf(InvalidError)
    await expect(bujo.updateEntry(goal, { status: 'task' })).rejects.toThrow(/goal cannot be turned/)
    const task = await bujo.addEntry('2026-11-21', 'task', 'task')
    await expect(bujo.rescheduleEntry(task, '2026-W48')).rejects.toBeInstanceOf(InvalidError)
    await expect(bujo.updateEntry(task, { status: 'goal' })).rejects.toBeInstanceOf(InvalidError)
    await expect(bujo.updateEntry(task, { goalState: 'achieved' })).rejects.toThrow(/Only goals/)
  })
})

describe('future log (month-dated entries)', () => {
  it('schedules a task for a month and later onto a day', async () => {
    const { db, bujo } = newBujo()
    const task = await bujo.addEntry('2026-11-21', 'task', 'Renew passport')
    const future = await bujo.rescheduleEntry(task, '2027-02')

    expect(future).toMatchObject({ date: '2027-02', status: 'task', dateHistory: ['2026-11-21'] })
    expect((await bujo.getMonthScheduledEntries()).map((e) => e.body)).toEqual(['Renew passport'])
    expect((await dump(db)).ghosts).toMatchObject([{ date: '2026-11-21' }])

    const dated = await bujo.rescheduleEntry(future, '2027-02-10')
    expect(dated.dateHistory).toEqual(['2026-11-21', '2027-02'])
    expect(await bujo.getMonthScheduledEntries()).toEqual([])
    // Still exactly one ghost: none was left on the month
    expect(((await dump(db)).ghosts as GhostEntry[]).map((g) => g.date)).toEqual(['2026-11-21'])
  })

  it('does not list monthly goals as future log items', async () => {
    const { bujo } = newBujo()
    await bujo.addGoal('2026-12', 'December goal')
    await bujo.addEntry('2026-12', 'task', 'December task')
    expect((await bujo.getMonthScheduledEntries()).map((e) => e.body)).toEqual(['December task'])
  })
})

describe('dropped, priority and time', () => {
  it('drops and reopens a task', async () => {
    const { bujo } = newBujo()
    const task = await bujo.addEntry('2026-11-21', 'task', 'Maybe not')
    const dropped = await bujo.dropEntry(task)
    expect(dropped.status).toBe('dropped')
    expect(isOpen(dropped)).toBe(false)
    expect(isClosed(dropped)).toBe(true)
    expect(dropped.prevStatus).toBeUndefined()

    const reopened = await bujo.reopenEntry(dropped)
    expect(reopened.status).toBe('task')
  })

  it('reopens an entry as what it was before', async () => {
    const { bujo } = newBujo()
    const event = await bujo.addEntry('2026-11-21', 'event', 'Standup', { time: '09:30' })
    const cancelled = await bujo.dropEntry(event)
    expect(cancelled).toMatchObject({ status: 'dropped', prevStatus: 'event', time: '09:30' })

    // Changing how it was closed does not lose the original status
    const completed = await bujo.completeEntry(cancelled)
    expect(completed).toMatchObject({ status: 'completed', prevStatus: 'event' })

    const reopened = await bujo.reopenEntry(completed)
    expect(reopened).toMatchObject({ status: 'event', time: '09:30' })
    expect(reopened.prevStatus).toBeUndefined()
  })

  it('makes completing, dropping and reopening idempotent', async () => {
    const { bujo } = newBujo()
    const task = await bujo.addEntry('2026-11-21', 'task', 'Once')
    const done = await bujo.completeEntry(task)
    const again = await bujo.completeEntry(done)
    expect(again._rev).toBe(done._rev) // no second write

    const open = await bujo.reopenEntry(again)
    expect((await bujo.reopenEntry(open))._rev).toBe(open._rev)
    const note = await bujo.addEntry('2026-11-21', 'note', 'Just a note')
    expect((await bujo.reopenEntry(note)).status).toBe('note')
  })

  it('sets and clears priority without leaving a false flag behind', async () => {
    const { bujo } = newBujo()
    const task = await bujo.addEntry('2026-11-21', 'task', 'Important', { priority: true })
    expect(task.priority).toBe(true)

    const plain = await bujo.updateEntry(task, { priority: false })
    expect('priority' in plain).toBe(false)
    expect((await bujo.updateEntry(plain, { priority: true })).priority).toBe(true)

    const ordinary = await bujo.addEntry('2026-11-21', 'task', 'Ordinary')
    expect('priority' in ordinary).toBe(false)
  })

  it('keeps priority and time through a move', async () => {
    const { bujo } = newBujo()
    const event = await bujo.addEntry('2026-11-21', 'event', 'Dentist', { time: '14:30', priority: true })
    const moved = await bujo.rescheduleEntry(event, '2026-11-28')
    expect(moved).toMatchObject({ status: 'event', time: '14:30', priority: true })
  })

  it('accepts a time only on events, in 24h HH:MM', async () => {
    const { bujo } = newBujo()
    const event = await bujo.addEntry('2026-11-21', 'event', 'Dentist', { time: '14:30' })
    expect(event.time).toBe('14:30')

    for (const bad of ['2pm', '24:00', '9:30', '12:60', '']) {
      await expect(bujo.addEntry('2026-11-21', 'event', 'x', { time: bad }), bad).rejects.toThrow(/Invalid time/)
    }
    await expect(bujo.addEntry('2026-11-21', 'task', 'x', { time: '10:00' })).rejects.toThrow(/Only events/)

    const later = await bujo.updateEntry(event, { time: '15:00' })
    expect(later.time).toBe('15:00')
    const untimed = await bujo.updateEntry(later, { time: null })
    expect('time' in untimed).toBe(false)

    const task = await bujo.addEntry('2026-11-21', 'task', 'task')
    await expect(bujo.updateEntry(task, { time: '10:00' })).rejects.toThrow(/Only events/)
    // Becoming an event and getting a time in one update is fine
    expect(await bujo.updateEntry(task, { status: 'event', time: '10:00' })).toMatchObject({
      status: 'event',
      time: '10:00',
    })
  })

  it('rejects empty text', async () => {
    const { bujo } = newBujo()
    await expect(bujo.addEntry('2026-11-21', 'task', '   ')).rejects.toThrow(/cannot be empty/)
    const task = await bujo.addEntry('2026-11-21', 'task', '  padded  ')
    expect(task.body).toBe('padded')
    await expect(bujo.updateEntry(task, { body: ' ' })).rejects.toBeInstanceOf(InvalidError)
  })
})

describe('backwards compatibility', () => {
  it('reads and updates documents written before the new fields existed', async () => {
    const { db, bujo } = newBujo()
    const old: BujoEntry = {
      _id: '2026-10-05:1791000000000:ab12cd',
      type: 'entry',
      date: '2026-10-05',
      status: 'task',
      body: 'From the old app #legacy',
      createdAt: 1791000000000,
      userId: 'me@example.com',
      tags: ['legacy'],
    }
    await db.put(old)

    const [found] = await bujo.getEntriesForTag('legacy')
    expect(isOpen(found)).toBe(true)

    const done = await bujo.completeEntry(found)
    // Nothing new is written unless it is used
    expect(Object.keys(done).sort()).toEqual(
      ['_id', '_rev', 'body', 'createdAt', 'date', 'status', 'tags', 'type', 'userId'].sort(),
    )
    expect(done.userId).toBe('me@example.com')
  })

  it('never writes the new fields for plain entries', async () => {
    const { bujo } = newBujo()
    const task = await bujo.addEntry('2026-11-21', 'task', 'Plain')
    expect(Object.keys(task).sort()).toEqual(['_id', '_rev', 'body', 'createdAt', 'date', 'status', 'type'].sort())
  })
})
