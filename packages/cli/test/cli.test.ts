import { describe, expect, it } from 'vitest'
import { makeCli } from './helpers'

// The fixed clock makes "today" 2026-11-21, a Saturday in ISO week 2026-W47.
const TODAY = '2026-11-21'

describe('capture', () => {
  it('adds a task for today and returns the entry', async () => {
    const { ok } = makeCli()
    const out = await ok('add', 'Call plumber #house')

    expect(out).toMatchObject({ ok: true, command: 'add', today: TODAY })
    expect(out.entry).toEqual({
      ref: expect.stringMatching(/^[0-9a-z]{6}$/),
      id: expect.stringMatching(/^2026-11-21:\d+:[0-9a-z]{6}$/),
      status: 'task',
      date: TODAY,
      dateKind: 'day',
      body: 'Call plumber #house',
      text: 'Call plumber',
      tags: ['house'],
      priority: false,
      open: true,
      time: null,
      goalState: null,
      dateHistory: [],
      moves: 0,
      createdAt: expect.stringMatching(/^2026-11-21T18:\d\d:\d\d\.000Z$/),
    })
    expect(out.entry.id.endsWith(`:${out.entry.ref}`)).toBe(true)
  })

  it('joins unquoted words into the text', async () => {
    const { ok } = makeCli()
    expect((await ok('add', 'Buy', 'more', 'paint')).entry.body).toBe('Buy more paint')
  })

  it.each([
    ['tomorrow', '2026-11-22', 'day'],
    ['mon', '2026-11-23', 'day'],
    ['+3d', '2026-11-24', 'day'],
    ['-1d', '2026-11-20', 'day'],
    ['next-week', '2026-11-23', 'day'],
    ['2026-12-24', '2026-12-24', 'day'],
    ['2027-02', '2027-02', 'month'],
    ['next-month', '2026-12', 'month'],
    ['unscheduled', 'unscheduled', 'unscheduled'],
  ])('resolves --date %s to %s', async (input, date, dateKind) => {
    const { ok } = makeCli()
    expect((await ok('add', 'x', '--date', input)).entry).toMatchObject({ date, dateKind })
  })

  it('adds events, notes and priorities', async () => {
    const { ok } = makeCli()
    expect((await ok('add', 'Dentist', '--event', '--time', '14:30')).entry).toMatchObject({ status: 'event', time: '14:30' })
    expect((await ok('add', 'Standup', '--time', '09:00')).entry).toMatchObject({ status: 'event', time: '09:00' })
    expect((await ok('add', 'Boiler serviced', '--note')).entry).toMatchObject({ status: 'note', open: false })
    expect((await ok('add', 'Taxes', '--priority')).entry).toMatchObject({ status: 'task', priority: true })
  })

  it('rejects bad input with exit code 1 and writes nothing', async () => {
    const { cli, ok } = makeCli()
    for (const args of [
      ['add', 'x', '--date', 'soonish'],
      ['add', 'x', '--date', '2026-02-30'],
      ['add', 'x', '--date', '2026-W48'],
      ['add', 'x', '--time', '25:00'],
      ['add', 'x', '--note', '--event'],
      ['add', '   '],
      ['add'],
    ]) {
      const result = await cli(...args)
      expect(result.code, args.join(' ')).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toMatch(/^error: /)
    }
    expect((await ok('today')).entries).toEqual([])
  })

  it('adds goals for the current week by default, or a given week or month', async () => {
    const { ok } = makeCli()
    expect((await ok('goal', 'Ship the CLI')).entry).toMatchObject({
      status: 'goal', date: '2026-W47', dateKind: 'week', goalState: 'open', open: true,
    })
    expect((await ok('goal', 'Next week', '--week', 'next')).entry.date).toBe('2026-W48')
    expect((await ok('goal', 'Explicit', '--week', '2026-W50')).entry.date).toBe('2026-W50')
    expect((await ok('goal', 'Run 60 km', '--month')).entry).toMatchObject({ date: '2026-11', dateKind: 'month' })
    expect((await ok('goal', 'December', '--month', '2026-12')).entry.date).toBe('2026-12')
    expect((await ok('goal', 'In two months', '--month', '+2')).entry.date).toBe('2027-01')
  })

  it('refuses a goal for both a week and a month', async () => {
    const { cli } = makeCli()
    expect((await cli('goal', 'x', '--week', '--month')).code).toBe(1)
  })
})

describe('daily log', () => {
  async function seeded() {
    const ctx = makeCli()
    const refs: Record<string, string> = {}
    const add = async (name: string, ...args: string[]) => (refs[name] = (await ctx.ok('add', ...args)).entry.ref)
    await add('note', 'Boiler serviced', '--note')
    await add('done', 'Already done')
    await ctx.ok('done', refs.done)
    await add('late', 'Late meeting', '--time', '16:00')
    await add('task', 'Plain task')
    await add('early', 'Early meeting', '--time', '09:00')
    await add('prio', 'Urgent task', '--priority')
    await add('dropped', 'Not happening')
    await ctx.ok('drop', refs.dropped)
    await add('gone', 'Pushed to Monday')
    await ctx.ok('move', refs.gone, 'mon')
    return { ...ctx, refs }
  }

  it('lists open tasks first, priority on top, then events by time, notes, done, dropped', async () => {
    const { ok } = await seeded()
    const out = await ok('today')
    expect(out).toMatchObject({ date: TODAY, weekday: 'Saturday', isToday: true, week: '2026-W47' })
    expect(out.entries.map((e: { body: string }) => e.body)).toEqual([
      'Urgent task',
      'Plain task',
      'Early meeting',
      'Late meeting',
      'Boiler serviced',
      'Already done',
      'Not happening',
    ])
  })

  it('shows entries that moved away as ghosts', async () => {
    const { ok, refs } = await seeded()
    const out = await ok('today')
    expect(out.ghosts).toHaveLength(1)
    expect(out.ghosts[0]).toMatchObject({ ref: refs.gone, ghostDate: TODAY, date: '2026-11-23', moves: 1 })

    const monday = await ok('today', '--date', 'mon')
    expect(monday).toMatchObject({ date: '2026-11-23', isToday: false, overdue: [] })
    expect(monday.entries.map((e: { ref: string }) => e.ref)).toEqual([refs.gone])
  })

  it('renders signifiers, refs and struck-through dropped entries as plain text', async () => {
    const { cli, refs } = await seeded()
    const { stdout, code } = await cli('today')
    expect(code).toBe(0)
    expect(stdout).not.toMatch(/\x1b\[/) // eslint-disable-line no-control-regex
    expect(stdout.split('\n')).toEqual([
      'Sat 21 Nov 2026 · today · 2026-W47',
      '',
      `  ${refs.prio}  *• Urgent task`,
      `  ${refs.task}   • Plain task`,
      `  ${refs.early}   ○ 09:00 Early meeting`,
      `  ${refs.late}   ○ 16:00 Late meeting`,
      `  ${refs.note}   – Boiler serviced`,
      `  ${refs.done}   × Already done`,
      `  ${refs.dropped}   • ~~Not happening~~`,
      `  ${refs.gone}   > Pushed to Monday  → 2026-11-23`,
      '',
    ])
  })

  it('marks an entry sent to the future log with <', async () => {
    const { cli, ok } = makeCli()
    const { ref } = (await ok('add', 'Someday maybe')).entry
    await ok('schedule', ref, 'unscheduled')
    expect((await cli('today')).stdout).toContain(`  ${ref}   < Someday maybe  → unscheduled`)
  })

  it('uses colors and real strikethrough only when asked to', async () => {
    const colored = makeCli({ env: { FORCE_COLOR: '1' } })
    const { ref } = (await colored.ok('add', 'Not happening')).entry
    await colored.ok('drop', ref)
    expect((await colored.cli('today')).stdout).toContain('\x1b[9mNot happening\x1b[29m')
    expect((await colored.cli('today', '--no-color')).stdout).toContain('~~Not happening~~')
    expect((await colored.cli('--no-color', 'today')).stdout).not.toContain('\x1b[')
    expect((await colored.cli('today', '--json')).stdout).not.toContain('\x1b[')

    const noColor = makeCli({ env: { FORCE_COLOR: '1', NO_COLOR: '1' } })
    await noColor.ok('add', 'x')
    expect((await noColor.cli('today')).stdout).not.toContain('\x1b[')
  })

  it('shows today when run without a command', async () => {
    const { cli, ok } = makeCli()
    await ok('add', 'Something')
    expect((await cli()).stdout).toContain('Sat 21 Nov 2026 · today')
    expect((await cli('--json')).json()).toMatchObject({ command: 'today', date: TODAY })
  })

  it('points out open tasks left on earlier days', async () => {
    const { cli, ok } = makeCli()
    await ok('add', 'Forgotten', '--date', '-3d')
    const out = await ok('today')
    expect(out.overdue.map((e: { body: string }) => e.body)).toEqual(['Forgotten'])
    expect((await cli('today')).stdout).toContain('1 open task left on earlier days — run `bujo migrate`')
  })

  it('decides what today is from the timezone', async () => {
    // The clock reads about 18:00 UTC on the 21st
    const { cli } = makeCli()
    expect((await cli('today', '--json', '--tz', 'Pacific/Kiritimati')).json().date).toBe('2026-11-22')
    expect((await cli('--tz', 'America/Chicago', 'today', '--json')).json().date).toBe(TODAY)
    const bad = await cli('today', '--tz', 'Mars/Phobos')
    expect(bad.code).toBe(1)
    expect(bad.stderr).toContain('Unknown timezone "Mars/Phobos"')

    const fromEnv = makeCli({ env: { BUJO_TZ: 'Pacific/Kiritimati' } })
    expect((await fromEnv.ok('today')).date).toBe('2026-11-22')
  })
})

describe('changing entries', () => {
  it('completes, drops and reopens by ref, id or text', async () => {
    const { ok } = makeCli()
    const a = (await ok('add', 'Call plumber')).entry
    const b = (await ok('add', 'Email landlord')).entry
    const c = (await ok('add', 'Water plants')).entry

    expect((await ok('done', a.ref, b.id)).entries.map((e: { status: string }) => e.status)).toEqual(['completed', 'completed'])
    expect((await ok('drop', 'water')).entries[0]).toMatchObject({ ref: c.ref, status: 'dropped', open: false })
    expect((await ok('undo', 'plants')).entries[0]).toMatchObject({ status: 'task', open: true })
    expect((await ok('undo', a.ref)).entries[0]).toMatchObject({ status: 'task' })
  })

  it('prefers open entries for done and closed ones for undo', async () => {
    const { ok } = makeCli()
    const old = (await ok('add', 'Call bank', '--date', '-5d')).entry
    await ok('done', old.ref)
    const fresh = (await ok('add', 'Call bank again')).entry

    expect((await ok('done', 'call bank')).entries[0].ref).toBe(fresh.ref)
    // Both are closed now, so "call bank" no longer says which one
    const { cli } = makeCli()
    expect((await cli('undo', 'call bank')).code).toBe(2)
  })

  it('keeps the ref when an entry moves, and resolves its old id', async () => {
    const { ok } = makeCli()
    const entry = (await ok('add', 'Renew passport')).entry

    const moved = await ok('move', entry.ref, '+3d')
    expect(moved).toMatchObject({ from: TODAY })
    expect(moved.entry).toMatchObject({ ref: entry.ref, date: '2026-11-24', dateHistory: [TODAY], moves: 1 })
    expect(moved.entry.id).not.toBe(entry.id)

    const again = await ok('move', entry.id, 'tomorrow') // the id from before the first move
    expect(again.entry).toMatchObject({ ref: entry.ref, date: '2026-11-22', moves: 2 })
    expect((await ok('show', entry.ref)).entry.dateHistory).toEqual([TODAY, '2026-11-24'])
  })

  it('sends entries to the future log with schedule', async () => {
    const { cli, ok } = makeCli()
    const entry = (await ok('add', 'Renew passport')).entry
    expect((await ok('schedule', entry.ref, '2027-02')).entry).toMatchObject({ date: '2027-02', dateKind: 'month' })
    expect((await ok('schedule', entry.ref, 'unscheduled')).entry).toMatchObject({ date: 'unscheduled' })
    expect((await ok('schedule', entry.ref, 'next-month')).entry.date).toBe('2026-12')

    const day = await cli('schedule', entry.ref, 'tomorrow')
    expect(day.code).toBe(1)
    expect(day.stderr).toContain('use `bujo move')
  })

  it('moves goals between periods only', async () => {
    const { cli, ok } = makeCli()
    const goal = (await ok('goal', 'Ship it')).entry
    expect((await ok('move', goal.ref, '2026-W48')).entry).toMatchObject({ date: '2026-W48', ref: goal.ref })
    expect((await ok('move', goal.ref, '2026-12')).entry.date).toBe('2026-12')
    // A day stands for the week it is in
    expect((await ok('move', goal.ref, '2026-12-09')).entry.date).toBe('2026-W50')
    expect((await ok('move', goal.ref, 'next-week')).entry.date).toBe('2026-W48')
    expect((await ok('schedule', goal.ref, 'next-month')).entry.date).toBe('2026-12')
    expect((await cli('move', goal.ref, 'unscheduled')).code).toBe(1)

    const task = (await ok('add', 'A task')).entry
    expect((await cli('move', task.ref, '2026-W48')).code).toBe(1)
  })

  it('tracks goal progress with done, drop and undo', async () => {
    const { ok } = makeCli()
    const goal = (await ok('goal', 'Ship it')).entry
    expect((await ok('done', goal.ref)).entries[0]).toMatchObject({ status: 'goal', goalState: 'achieved', open: false })
    expect((await ok('drop', goal.ref)).entries[0]).toMatchObject({ goalState: 'dropped' })
    expect((await ok('undo', goal.ref)).entries[0]).toMatchObject({ goalState: 'open', open: true })
  })

  it('edits text and re-reads the tags', async () => {
    const { ok } = makeCli()
    const entry = (await ok('add', 'Fix sink #house')).entry
    const edited = (await ok('edit', entry.ref, 'Fix', 'the', 'kitchen sink #diy')).entries[0]
    expect(edited).toMatchObject({ ref: entry.ref, body: 'Fix the kitchen sink #diy', tags: ['diy'] })
  })

  it('sets and clears priority', async () => {
    const { ok } = makeCli()
    const entry = (await ok('add', 'Taxes')).entry
    expect((await ok('prio', entry.ref)).entries[0].priority).toBe(true)
    expect((await ok('prio', entry.ref, '--off')).entries[0].priority).toBe(false)
  })
})

describe('references that do not resolve', () => {
  it('exits 2 when nothing matches', async () => {
    const { cli } = makeCli()
    const result = await cli('done', 'nothing-like-this')
    expect(result.code).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('error: No entry matches "nothing-like-this"\n')
  })

  it('exits 2 and lists the candidates when a text is ambiguous', async () => {
    const { cli, ok } = makeCli()
    const a = (await ok('add', 'Call plumber')).entry
    const b = (await ok('add', 'Call mum')).entry

    const result = await cli('done', 'call')
    expect(result.code).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('error: "call" matches 2 entries; use a ref')
    expect(result.stderr).toContain(`${a.ref}  2026-11-21    • Call plumber`)
    expect(result.stderr).toContain(`${b.ref}  2026-11-21    • Call mum`)

    // Nothing was changed
    expect((await ok('today')).entries.every((e: { open: boolean }) => e.open)).toBe(true)
  })

  it('reports errors as JSON on stderr with --json', async () => {
    const { cli, ok } = makeCli()
    const a = (await ok('add', 'Call plumber')).entry
    const b = (await ok('add', 'Call mum')).entry

    const ambiguous = await cli('done', 'call', '--json')
    expect(ambiguous.code).toBe(2)
    expect(ambiguous.stdout).toBe('')
    const error = ambiguous.errorJson()
    expect(error).toMatchObject({ ok: false, error: { code: 'ambiguous' } })
    expect(error.error.candidates.map((c: { ref: string }) => c.ref).sort()).toEqual([a.ref, b.ref].sort())

    expect((await cli('done', 'nope-nope', '--json')).errorJson()).toMatchObject({
      ok: false,
      error: { code: 'not_found', message: 'No entry matches "nope-nope"' },
    })
    expect((await cli('add', 'x', '--date', 'soonish', '--json')).errorJson().error.code).toBe('invalid')
    expect((await cli('frobnicate', '--json')).errorJson().error.code).toBe('usage')
  })

  it('does not match on a text fragment shorter than 3 characters', async () => {
    const { cli, ok } = makeCli()
    await ok('add', 'Only task')
    const result = await cli('done', 'ta')
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('at least 3 characters')
  })

  it('changes nothing when one of several references fails', async () => {
    const { cli, ok } = makeCli()
    const a = (await ok('add', 'First')).entry
    expect((await cli('done', a.ref, 'missing-one')).code).toBe(2)
    expect((await ok('show', a.ref)).entry.status).toBe('task')
  })
})

describe('destructive commands', () => {
  it('refuses rm without --yes when there is no terminal', async () => {
    const { cli, ok, questions } = makeCli()
    const entry = (await ok('add', 'Keep me')).entry

    const refused = await cli('rm', entry.ref)
    expect(refused.code).toBe(1)
    expect(refused.stderr).toContain('Refusing to delete an entry without --yes')
    expect(questions).toEqual([])
    expect((await ok('show', entry.ref)).entry.ref).toBe(entry.ref)

    const deleted = await ok('rm', entry.ref, '--yes')
    expect(deleted.deleted.map((e: { ref: string }) => e.ref)).toEqual([entry.ref])
    expect((await cli('show', entry.ref)).code).toBe(2)
  })

  it('asks on a terminal and respects the answer', async () => {
    const declined = makeCli({ tty: true, answer: false })
    const kept = (await declined.ok('add', 'Keep me')).entry
    const no = await declined.cli('rm', kept.ref)
    expect(no.code).toBe(1)
    expect(no.stderr).toContain('Cancelled')
    expect(declined.questions[0]).toContain('Delete this entry?')
    expect(declined.questions[0]).toContain('Keep me')
    expect((await declined.ok('today')).entries).toHaveLength(1)

    const accepted = makeCli({ tty: true, answer: true })
    const gone = (await accepted.ok('add', 'Delete me')).entry
    expect((await accepted.cli('rm', gone.ref)).code).toBe(0)
    expect((await accepted.ok('today')).entries).toHaveLength(0)

    // --yes skips the question even on a terminal
    const other = (await accepted.ok('add', 'Me too')).entry
    accepted.questions.length = 0
    expect((await accepted.cli('rm', other.ref, '-y')).code).toBe(0)
    expect(accepted.questions).toEqual([])
  })

  it('removes the ghosts along with the entry', async () => {
    const { ok } = makeCli()
    const entry = (await ok('add', 'Wanderer')).entry
    await ok('move', entry.ref, 'tomorrow')
    await ok('rm', entry.ref, '--yes')
    expect((await ok('today')).ghosts).toEqual([])
  })

  it('needs --yes to drop several entries at once, but not one', async () => {
    const { cli, ok } = makeCli()
    const a = (await ok('add', 'First')).entry
    const b = (await ok('add', 'Second')).entry

    const refused = await cli('drop', a.ref, b.ref)
    expect(refused.code).toBe(1)
    expect(refused.stderr).toContain('Refusing to drop 2 entries without --yes')
    expect((await ok('today')).entries.every((e: { open: boolean }) => e.open)).toBe(true)

    expect((await cli('drop', a.ref)).code).toBe(0)
    expect((await cli('drop', a.ref, b.ref, '--yes')).code).toBe(0)
    expect((await ok('today')).entries.map((e: { status: string }) => e.status)).toEqual(['dropped', 'dropped'])
  })

  it('never guesses between matches when deleting', async () => {
    const { cli, ok } = makeCli()
    const open = (await ok('add', 'Call bank')).entry
    const closed = (await ok('add', 'Call bank back')).entry
    await ok('done', closed.ref)
    // `done` would pick the open one; rm must not
    expect((await cli('rm', 'call bank', '--yes')).code).toBe(2)
    expect((await ok('show', open.ref)).entry.ref).toBe(open.ref)
  })
})

describe('migrate and stale', () => {
  it('previews with --dry-run, then moves open tasks to today', async () => {
    const { cli, ok } = makeCli()
    const old = (await ok('add', 'Left behind', '--date', '-2d')).entry
    await ok('add', 'Done back then', '--date', '-2d')
    await ok('done', 'Done back then')
    await ok('add', 'Not due yet', '--date', 'tomorrow')

    const preview = await ok('migrate', '--dry-run')
    expect(preview).toMatchObject({ today: TODAY, dryRun: true, count: 1 })
    expect(preview.entries[0]).toMatchObject({ ref: old.ref, date: '2026-11-19', moves: 0 })
    expect((await ok('show', old.ref)).entry.date).toBe('2026-11-19')

    const result = await ok('migrate')
    expect(result).toMatchObject({ dryRun: false, count: 1 })
    expect(result.entries[0]).toMatchObject({ ref: old.ref, date: TODAY, dateHistory: ['2026-11-19'], moves: 1 })

    expect((await ok('migrate')).count).toBe(0)
    expect((await cli('migrate')).stdout).toBe('Nothing to migrate.\n')
    expect((await ok('today', '--date', '-2d')).ghosts.map((g: { ref: string }) => g.ref)).toEqual([old.ref])
  })

  it('lists tasks that keep getting moved', async () => {
    const { ok } = makeCli()
    const entry = (await ok('add', 'Procrastinated', '--date', '-4d')).entry
    for (const date of ['-3d', '-2d', '-1d']) await ok('move', entry.ref, date)
    await ok('add', 'Fresh')

    expect((await ok('stale')).entries.map((e: { ref: string; moves: number }) => [e.ref, e.moves])).toEqual([[entry.ref, 3]])
    expect((await ok('stale', '--min-moves', '4')).entries).toEqual([])
    expect(await ok('stale', '-n', '1')).toMatchObject({ minMoves: 1 })

    const { cli } = makeCli()
    expect((await cli('stale', '--min-moves', 'lots')).code).toBe(1)
  })
})

describe('weekly, monthly and future logs', () => {
  async function seeded() {
    const ctx = makeCli()
    await ctx.ok('goal', 'Ship the CLI')
    await ctx.ok('goal', 'Run 60 km', '--month')
    await ctx.ok('add', 'Monday task', '--date', '2026-11-16')
    await ctx.ok('add', 'Today task')
    await ctx.ok('add', 'Dentist', '--date', '2026-11-27', '--time', '14:30')
    await ctx.ok('add', 'December task', '--date', '2026-12-03')
    await ctx.ok('add', 'Sometime in November', '--date', '2026-11')
    await ctx.ok('add', 'Sometime in February', '--date', '2027-02')
    await ctx.ok('add', 'Someday', '--date', 'unscheduled')
    return ctx
  }

  it('shows the week: goals, then Monday to Sunday', async () => {
    const { ok } = await seeded()
    const week = await ok('week')
    expect(week).toMatchObject({ week: '2026-W47', start: '2026-11-16', end: '2026-11-22', current: true })
    expect(week.goals.map((g: { body: string }) => g.body)).toEqual(['Ship the CLI'])
    expect(week.days.map((d: { date: string }) => d.date)).toEqual([
      '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22',
    ])
    expect(week.days[0]).toMatchObject({ weekday: 'Monday', isToday: false })
    expect(week.days[0].entries.map((e: { body: string }) => e.body)).toEqual(['Monday task'])
    expect(week.days[5]).toMatchObject({ weekday: 'Saturday', isToday: true })
  })

  it('navigates weeks relatively and absolutely', async () => {
    const { ok } = await seeded()
    expect(await ok('week', '+1')).toMatchObject({ week: '2026-W48', current: false })
    expect((await ok('week', '-1')).week).toBe('2026-W46')
    expect((await ok('week', 'next')).week).toBe('2026-W48')
    expect((await ok('week', '2026-W53')).end).toBe('2027-01-03')
    expect((await ok('week', '2026-12-03')).week).toBe('2026-W49')
  })

  it('shows the month: goals, undated items, a calendar summary and open tasks', async () => {
    const { ok } = await seeded()
    const month = await ok('month')
    expect(month).toMatchObject({ month: '2026-11', start: '2026-11-01', end: '2026-11-30', current: true })
    expect(month.goals.map((g: { body: string }) => g.body)).toEqual(['Run 60 km'])
    expect(month.undated.map((e: { body: string }) => e.body)).toEqual(['Sometime in November'])
    expect(month.days).toHaveLength(30)
    expect(month.days[15]).toEqual({
      date: '2026-11-16',
      weekday: 'Monday',
      isToday: false,
      counts: { total: 1, open: 1, completed: 0, dropped: 0, events: 0, notes: 0, ghosts: 0 },
    })
    expect(month.open.map((e: { body: string }) => e.body)).toEqual(['Monday task', 'Today task'])
    expect(month.events.map((e: { body: string }) => e.body)).toEqual(['Dentist'])
    expect((await ok('month', '+1')).open.map((e: { body: string }) => e.body)).toEqual(['December task'])
    expect((await ok('month', '2027-02')).undated.map((e: { body: string }) => e.body)).toEqual(['Sometime in February'])
  })

  it('draws the month as a calendar', async () => {
    const { cli } = await seeded()
    const { stdout } = await cli('month')
    expect(stdout).toContain('November 2026 · this month')
    expect(stdout).toContain('    Mo   Tu   We   Th   Fr   Sa   Su')
    expect(stdout).toContain('    16•  17   18   19   20 [21•]  22')
    expect(stdout).toContain('    23   24   25   26   27○  28   29')
  })

  it('shows the future log: unscheduled, then by month', async () => {
    const { ok } = await seeded()
    const future = await ok('future')
    expect(future.unscheduled.map((e: { body: string }) => e.body)).toEqual(['Someday'])
    expect(future.months.map((m: { month: string; entries: { body: string }[] }) => [m.month, m.entries.map((e) => e.body)])).toEqual([
      ['2026-11', ['Sometime in November', 'Dentist']],
      ['2026-12', ['December task']],
      ['2027-02', ['Sometime in February']],
    ])
  })

  it('leaves closed entries out of the future log unless asked', async () => {
    const { ok } = await seeded()
    await ok('done', 'December task')
    expect((await ok('future')).months.map((m: { month: string }) => m.month)).toEqual(['2026-11', '2027-02'])
    expect((await ok('future', '--all')).months.map((m: { month: string }) => m.month)).toEqual(['2026-11', '2026-12', '2027-02'])
  })
})

describe('collections and search', () => {
  async function seeded() {
    const ctx = makeCli()
    await ctx.ok('add', 'Fix sink #house')
    await ctx.ok('add', 'Paint fence #house #garden', '--date', 'tomorrow')
    await ctx.ok('add', 'Boiler serviced #house', '--note', '--date', '-3d')
    await ctx.ok('add', 'Old chore #house', '--date', '-5d')
    await ctx.ok('done', 'Old chore')
    await ctx.ok('add', 'Unrelated')
    return ctx
  }

  it('lists tags with open and total counts', async () => {
    const { ok } = await seeded()
    expect((await ok('tags')).tags.map((t: { name: string; open: number; total: number }) => [t.name, t.open, t.total])).toEqual([
      ['garden', 1, 1],
      ['house', 2, 4],
    ])
  })

  it('shows a collection, open entries first', async () => {
    const { ok } = await seeded()
    const tag = await ok('tag', '#House')
    expect(tag).toMatchObject({ tag: 'house', name: 'house', open: 2, total: 4 })
    expect(tag.color).toMatch(/^#[0-9a-f]{6}$/)
    expect(tag.entries.map((e: { body: string }) => e.body)).toEqual([
      'Fix sink #house',
      'Paint fence #house #garden',
      'Boiler serviced #house',
      'Old chore #house',
    ])
    expect((await ok('tag', 'house', '--open')).entries).toHaveLength(2)
    expect(await ok('tag', 'nosuchtag')).toMatchObject({ total: 0, entries: [], color: null })
  })

  it('searches text, optionally only open entries', async () => {
    const { ok } = await seeded()
    expect((await ok('search', 'HOUSE')).entries).toHaveLength(4)
    expect((await ok('search', 'house', '--open')).entries).toHaveLength(2)
    expect((await ok('search', 'paint', 'fence')).query).toBe('paint fence')
    expect((await ok('search', 'zebra')).entries).toEqual([])
  })

  it('shows one entry in full', async () => {
    const { cli, ok } = makeCli()
    const entry = (await ok('add', 'Renew passport #admin', '--date', '-2d', '--priority')).entry
    await ok('move', entry.ref, '-1d')
    await ok('move', entry.ref, 'today')

    const detail = await ok('show', entry.ref)
    expect(detail.entry).toMatchObject({ ref: entry.ref, moves: 2, dateHistory: ['2026-11-19', '2026-11-20'], priority: true })
    expect(detail.ghostDates).toEqual(['2026-11-19', '2026-11-20'])

    const { stdout } = await cli('show', 'passport')
    expect(stdout).toContain(`${entry.ref}  *• Renew passport #admin  (moved 2×)`)
    expect(stdout).toContain('history   2026-11-19 → 2026-11-20 → 2026-11-21 (now)')
  })
})

describe('review', () => {
  async function seeded() {
    const ctx = makeCli()
    const { ok } = ctx
    await ok('goal', 'Ship the CLI')
    await ok('goal', 'Inbox zero')
    await ok('done', 'Ship the CLI')
    await ok('goal', 'Run 60 km', '--month')
    await ok('add', 'Finished early', '--date', '2026-11-16')
    await ok('done', 'Finished early')
    await ok('add', 'Still open', '--date', '2026-11-18')
    await ok('add', 'Gave up', '--date', '2026-11-19')
    await ok('drop', 'Gave up')
    await ok('add', 'Carried over', '--date', '2026-11-20')
    await ok('move', 'Carried over', '2026-11-25')
    await ok('add', 'Moved within the week', '--date', '2026-11-17')
    await ok('move', 'Moved within the week', '2026-11-19')
    await ok('add', 'Retro', '--date', '2026-11-20', '--time', '15:00')
    await ok('add', 'A thought', '--note')
    await ok('add', 'Last week task', '--date', '2026-11-12')
    const stale = (await ok('add', 'Keeps slipping', '--date', '2026-11-02')).entry
    for (const date of ['2026-11-03', '2026-11-04', '2026-11-05']) await ok('move', stale.ref, date)
    return ctx
  }

  it('bundles a week: counts, goals, done, open, dropped, migrated, stale', async () => {
    const { ok } = await seeded()
    const review = await ok('review', 'week')
    expect(review).toMatchObject({
      command: 'review', kind: 'week', period: '2026-W47', start: '2026-11-16', end: '2026-11-22', current: true,
      counts: {
        completed: 1, open: 2, dropped: 1, migrated: 1, events: 1, notes: 1,
        goals: { open: 1, achieved: 1, dropped: 0 },
      },
      staleMinMoves: 3,
    })
    const bodies = (list: { body: string }[]) => list.map((e) => e.body)
    expect(bodies(review.goals)).toEqual(['Inbox zero', 'Ship the CLI'])
    expect(review.goals.map((g: { goalState: string }) => g.goalState)).toEqual(['open', 'achieved'])
    expect(review.monthGoals).toMatchObject([{ month: '2026-11', goals: [{ body: 'Run 60 km' }] }])
    expect(bodies(review.completed)).toEqual(['Finished early'])
    expect(bodies(review.open)).toEqual(['Still open', 'Moved within the week'])
    expect(bodies(review.dropped)).toEqual(['Gave up'])
    expect(review.migrated).toMatchObject([{ body: 'Carried over', ghostDate: '2026-11-20', date: '2026-11-25' }])
    expect(bodies(review.stale)).toEqual(['Keeps slipping'])
  })

  it('reviews another week or a month, and is read-only', async () => {
    const { ok, db } = await seeded()
    const before = (await db.allDocs()).rows.map((r) => `${r.id}@${r.value?.rev}`)

    expect(await ok('review', 'week', '-1')).toMatchObject({ period: '2026-W46', current: false, counts: { open: 1 } })
    const month = await ok('review', 'month', '--dry-run')
    expect(month).toMatchObject({
      kind: 'month', period: '2026-11', start: '2026-11-01', end: '2026-11-30',
      counts: { completed: 1, dropped: 1, migrated: 0, goals: { open: 1, achieved: 0, dropped: 0 } },
      monthGoals: [],
    })
    expect(month.goals.map((g: { body: string }) => g.body)).toEqual(['Run 60 km'])
    expect((await ok('review', 'month', '2026-10')).counts.completed).toBe(0)
    expect((await ok('review', 'week', '--min-moves', '5')).stale).toEqual([])

    const after = (await db.allDocs()).rows.map((r) => `${r.id}@${r.value?.rev}`)
    expect(after).toEqual(before)
  })

  it('needs to know whether to review a week or a month', async () => {
    const { cli } = await seeded()
    const result = await cli('review', 'year')
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('bujo review week')
  })
})

describe('help and usage', () => {
  it('prints help and version with exit code 0', async () => {
    const { cli } = makeCli()
    const help = await cli('--help')
    expect(help.code).toBe(0)
    expect(help.stdout).toContain('Usage: bujo')
    expect(help.stdout).toContain('migrate')
    expect((await cli('add', '--help')).stdout).toContain('--priority')
    expect((await cli('--version')).code).toBe(0)
  })

  it('exits 1 on unknown commands and options', async () => {
    const { cli } = makeCli()
    for (const args of [['frobnicate'], ['today', '--frobnicate'], ['move', 'onlyref']]) {
      const result = await cli(...args)
      expect(result.code, args.join(' ')).toBe(1)
      expect(result.stderr).toMatch(/^error: .* — see `bujo --help`\n$/)
      expect(result.stdout).toBe('')
    }
  })
})
