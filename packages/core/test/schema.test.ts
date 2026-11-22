import { describe, expect, it } from 'vitest'
import {
  InvalidError,
  UNSCHEDULED,
  familyIndex,
  idTail,
  isClosed,
  isOpen,
  type BujoEntry,
  type GhostEntry,
} from '../src'
import { dump, newBujo } from './helpers'

describe('week- and month-dated entries', () => {
  it('stores an entry under its week or month key', async () => {
    const { bujo } = newBujo()
    const weekly = await bujo.addEntry('2026-W47', 'task', 'Ship the CLI #bujo')
    const monthly = await bujo.addEntry('2026-11', 'task', 'Run 60 km')

    expect(weekly).toMatchObject({ status: 'task', date: '2026-W47', tags: ['bujo'] })
    expect(weekly._id.startsWith('2026-W47:')).toBe(true)
    expect(monthly._id.startsWith('2026-11:')).toBe(true)
    expect(isOpen(weekly)).toBe(true)
  })

  it('returns the entries of one period with a prefix query', async () => {
    const { bujo } = newBujo()
    await bujo.addEntry('2026-W46', 'task', 'last week')
    await bujo.addEntry('2026-W47', 'task', 'this week A')
    await bujo.addEntry('2026-W47', 'note', 'this week B')
    await bujo.addEntry('2026-W48', 'task', 'next week')
    await bujo.addEntry('2026-11', 'task', 'this month')
    await bujo.addEntry('2026-12', 'task', 'next month')
    await bujo.addEntry('2026-11-21', 'task', 'a day in that week and month')

    expect((await bujo.getEntriesForPeriod('2026-W47')).map((e) => e.body)).toEqual(['this week A', 'this week B'])
    expect((await bujo.getEntriesForPeriod('2026-11')).map((e) => e.body)).toEqual(['this month'])
    expect(await bujo.getEntriesForPeriod('2026-W49')).toEqual([])
  })

  it('sorts period keys next to the days they cover', async () => {
    const { db, bujo } = newBujo()
    for (const date of [
      '2026-W47', '2026-11', '2026-12', '2026-W01', '2027-W01',
      '2026-11-01', '2026-11-30', '2026-12-01', '2027-01-01',
      UNSCHEDULED,
    ]) {
      await bujo.addEntry(date, 'task', `task ${date}`)
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

  it('keeps week- and month-dated entries out of day ranges', async () => {
    const { bujo } = newBujo()
    await bujo.addEntry('2026-11', 'task', 'sometime in November')
    await bujo.addEntry('2026-W49', 'task', 'sometime in week 49')
    await bujo.addEntry('2026-W53', 'task', 'last week of the year')
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

  it('completes, drops and reopens a week task like any other', async () => {
    const { bujo } = newBujo()
    const task = await bujo.addEntry('2026-W47', 'task', 'Ship it')

    const done = await bujo.completeEntry(task)
    expect(done).toMatchObject({ status: 'completed', date: '2026-W47' })
    expect(isClosed(done)).toBe(true)

    const dropped = await bujo.dropEntry(done)
    expect(dropped.status).toBe('dropped')

    const reopened = await bujo.reopenEntry(dropped)
    expect(reopened.status).toBe('task')
    expect(isOpen(reopened)).toBe(true)
  })

  it('moves between a day, a week and a month, keeping the ref; only days keep a ghost', async () => {
    const { db, bujo } = newBujo()
    const task = await bujo.addEntry('2026-W47', 'task', 'Slipped a week')
    const moved = await bujo.rescheduleEntry(task, '2026-W48')

    expect(moved._id).toBe(task._id.replace('2026-W47', '2026-W48'))
    expect(moved.dateHistory).toEqual(['2026-W47'])
    expect((await dump(db)).ghosts).toHaveLength(0)
    expect(await bujo.getEntriesForPeriod('2026-W47')).toEqual([])

    const onDay = await bujo.rescheduleEntry(moved, '2026-11-25')
    expect(onDay.date).toBe('2026-11-25')
    const monthly = await bujo.rescheduleEntry(onDay, '2026-12')
    expect(monthly).toMatchObject({ date: '2026-12', dateHistory: ['2026-W47', '2026-W48', '2026-11-25'] })
    expect(((await dump(db)).ghosts as GhostEntry[]).map((g) => g.date)).toEqual(['2026-11-25'])
  })

  it('refuses dates that do not exist', async () => {
    const { bujo } = newBujo()
    await expect(bujo.addEntry('2026-W54', 'task', 'no such week')).rejects.toBeInstanceOf(InvalidError)
    await expect(bujo.addEntry('2026-13', 'task', 'no such month')).rejects.toBeInstanceOf(InvalidError)
    await expect(bujo.addEntry('not-a-date', 'task', 'x')).rejects.toThrow(/Invalid date/)
    await expect(bujo.addEntry('', 'task', 'x')).rejects.toBeInstanceOf(InvalidError)
    const task = await bujo.addEntry('2026-11-21', 'task', 'task')
    await expect(bujo.rescheduleEntry(task, '2026-W54')).rejects.toBeInstanceOf(InvalidError)
  })
})

describe('goals stored by earlier versions', () => {
  // What a goal looked like: its own status, the outcome in `goalState`.
  const legacy = (id: string, body: string, goalState?: string) => ({
    _id: id,
    type: 'entry',
    date: id.split(':')[0],
    status: 'goal',
    body,
    createdAt: Number(id.split(':')[1]),
    ...(goalState ? { goalState } : {}),
  })

  async function seed() {
    const { db, bujo } = newBujo()
    await db.bulkDocs([
      legacy('2026-W47:1000:aaaaaa', 'Open goal'),
      legacy('2026-W47:2000:bbbbbb', 'Achieved goal', 'achieved'),
      legacy('2026-11:3000:cccccc', 'Dropped goal', 'dropped'),
    ] as unknown as BujoEntry[])
    return { db, bujo }
  }

  it('reads them as the tasks they now are', async () => {
    const { bujo } = await seed()
    const week = await bujo.getEntriesForPeriod('2026-W47')
    expect(week.map((e) => [e.body, e.status])).toEqual([['Open goal', 'task'], ['Achieved goal', 'completed']])
    expect((await bujo.getEntriesForPeriod('2026-11'))[0]).toMatchObject({ status: 'dropped' })
    expect(week.every((e) => !('goalState' in e))).toBe(true)
    expect((await bujo.findEntry('aaaaaa')).status).toBe('task')
  })

  it('stores one as a task the next time it is written', async () => {
    const { db, bujo } = await seed()
    await bujo.completeEntry(await bujo.findEntry('aaaaaa'))
    const stored = (await db.get('2026-W47:1000:aaaaaa')) as unknown as Record<string, unknown>
    expect(stored.status).toBe('completed')
    expect(stored.goalState).toBeUndefined()
  })

  it('rewrites all of them on request, once', async () => {
    const { db, bujo } = await seed()
    await bujo.addEntry('2026-11-21', 'task', 'An ordinary task')

    expect(await bujo.upgradeStoredEntries()).toBe(3)
    const stored = (await dump(db)).entries as unknown as Record<string, unknown>[]
    expect(stored.map((e) => e.status).sort()).toEqual(['completed', 'dropped', 'task', 'task'])
    expect(stored.some((e) => 'goalState' in e)).toBe(false)

    expect(await bujo.upgradeStoredEntries()).toBe(0)
  })
})

describe('subtasks', () => {
  it('links a new entry to its parent by the part of the id that survives a move', async () => {
    const { bujo } = newBujo()
    const epic = await bujo.addEntry('2026-W47', 'task', 'Ship v2')
    const sub = await bujo.addEntry('2026-11-17', 'task', 'Write the changelog', { parent: epic })
    expect(sub.parent).toBe(idTail(epic._id))

    // Moving either one changes neither the link nor what it finds
    const movedEpic = await bujo.rescheduleEntry(epic, '2026-W48')
    const movedSub = await bujo.rescheduleEntry(sub, '2026-11-24')
    expect(movedSub.parent).toBe(idTail(movedEpic._id))
    expect((await bujo.getChildren(movedEpic)).map((e) => e.body)).toEqual(['Write the changelog'])
  })

  it('attaches and detaches an existing entry', async () => {
    const { bujo } = newBujo()
    const epic = await bujo.addEntry('2026-W47', 'task', 'Ship v2')
    const task = await bujo.addEntry('2026-11-17', 'task', 'Tag the release')

    const attached = await bujo.setParent(task, epic)
    expect(attached.parent).toBe(idTail(epic._id))
    expect(await bujo.getChildren(epic)).toHaveLength(1)

    const detached = await bujo.setParent(attached, null)
    expect(detached.parent).toBeUndefined()
    expect(await bujo.getChildren(epic)).toEqual([])
  })

  it('goes one level deep only', async () => {
    const { bujo } = newBujo()
    const epic = await bujo.addEntry('2026-W47', 'task', 'Epic')
    const sub = await bujo.addEntry('2026-11-17', 'task', 'Subtask', { parent: epic })
    const other = await bujo.addEntry('2026-11-17', 'task', 'Other')

    // A subtask cannot take subtasks…
    await expect(bujo.addEntry('2026-11-17', 'task', 'Deeper', { parent: sub })).rejects.toThrow(/subtasks of its own/)
    await expect(bujo.setParent(other, sub)).rejects.toThrow(/subtasks of its own/)
    // …and an epic cannot become one
    await expect(bujo.setParent(epic, other)).rejects.toThrow(/cannot become a subtask/)
    await expect(bujo.setParent(epic, epic)).rejects.toThrow(/its own subtask/)
  })

  it('only lets a task hold subtasks', async () => {
    const { bujo } = newBujo()
    const note = await bujo.addEntry('2026-11-17', 'note', 'A note')
    const event = await bujo.addEntry('2026-11-17', 'event', 'An event')
    await expect(bujo.addEntry('2026-11-17', 'task', 'x', { parent: note })).rejects.toThrow(/Only a task/)
    await expect(bujo.addEntry('2026-11-17', 'task', 'x', { parent: event })).rejects.toThrow(/Only a task/)

    const epic = await bujo.addEntry('2026-W47', 'task', 'Epic')
    await bujo.addEntry('2026-11-17', 'note', 'A note under it', { parent: epic })
    await expect(bujo.updateEntry(epic, { status: 'note' })).rejects.toThrow(/has subtasks/)
    // Completing or dropping an epic is fine, and leaves its subtasks alone
    expect((await bujo.completeEntry(epic)).status).toBe('completed')
    expect((await bujo.getChildren(epic))[0].status).toBe('note')
  })

  it('keeps the subtasks of a deleted epic, as tasks of their own', async () => {
    const { db, bujo } = newBujo()
    const epic = await bujo.addEntry('2026-W47', 'task', 'Epic')
    await bujo.addEntry('2026-11-17', 'task', 'One', { parent: epic })
    await bujo.addEntry('2026-11-18', 'task', 'Two', { parent: epic })

    await bujo.deleteEntry(epic)
    const left = (await dump(db)).entries as BujoEntry[]
    expect(left.map((e) => e.body)).toEqual(['One', 'Two'])
    expect(left.every((e) => e.parent === undefined)).toBe(true)
  })

  it('counts progress over the subtasks that are tasks', async () => {
    const { bujo } = newBujo()
    const epic = await bujo.addEntry('2026-W47', 'task', 'Epic')
    const done = await bujo.addEntry('2026-11-17', 'task', 'Done', { parent: epic })
    await bujo.completeEntry(done)
    await bujo.addEntry('2026-11-18', 'task', 'Open', { parent: epic })
    const dropped = await bujo.addEntry('2026-11-18', 'task', 'Dropped', { parent: epic })
    await bujo.dropEntry(dropped)
    await bujo.addEntry('2026-11-18', 'note', 'A note', { parent: epic })
    const loner = await bujo.addEntry('2026-11-18', 'task', 'Not part of anything')

    const families = familyIndex(await bujo.getAllEntries())
    expect(families.progressOf(epic)).toEqual({ done: 1, total: 2 })
    expect(families.childrenOf(epic).map((e) => e.body)).toEqual(['Done', 'Open', 'Dropped', 'A note'])
    expect(families.parentOf(done)?.body).toBe('Epic')
    expect(families.progressOf(loner)).toBeNull()
    expect(families.parentOf(loner)).toBeUndefined()
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

  it('lists everything dated to a month as a whole', async () => {
    const { bujo } = newBujo()
    await bujo.addEntry('2026-12', 'task', 'December task')
    await bujo.addEntry('2026-W50', 'task', 'A week in December')
    await bujo.addEntry('2026-12-09', 'task', 'A day in December')
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
