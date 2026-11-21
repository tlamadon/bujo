import { describe, expect, it } from 'vitest'
import {
  InvalidError,
  UNSCHEDULED,
  addDays,
  addMonths,
  addWeeks,
  dateKind,
  daysBetween,
  isoWeekKey,
  monthDays,
  parseDateInput,
  parseMonthInput,
  parseWeekInput,
  periodRange,
  todayIn,
  weekDays,
  weekStart,
  weekdayOf,
  weeksInYear,
} from '../src'

// Saturday, in ISO week 47
const TODAY = '2026-11-21'

describe('date kinds', () => {
  it('classifies date values', () => {
    expect(dateKind('2026-11-21')).toBe('day')
    expect(dateKind('2026-11')).toBe('month')
    expect(dateKind('2026-W47')).toBe('week')
    expect(dateKind(UNSCHEDULED)).toBe('unscheduled')
  })

  it('rejects values that only look like dates', () => {
    for (const bad of ['', '2026-02-30', '2026-13', '2026-00', '2026-W00', '2026-W54', '2025-W53',
      '2026-1-1', 'tomorrow', '2026-w47', '2026-11-21T10:00']) {
      expect(dateKind(bad), bad).toBeNull()
    }
    expect(dateKind('2026-W53')).toBe('week') // 2026 is a 53-week year
    expect(dateKind('2028-02-29')).toBe('day')
  })
})

describe('day arithmetic', () => {
  it('adds days across months, years and DST changes', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2026-03-07', 2)).toBe('2026-03-09') // US spring-forward weekend
    expect(addDays('2026-10-31', 2)).toBe('2026-11-02') // US fall-back weekend
    expect(daysBetween('2026-11-21', '2026-12-01')).toBe(10)
    expect(daysBetween('2026-11-21', '2026-11-20')).toBe(-1)
  })

  it('numbers weekdays from Monday = 1', () => {
    expect(weekdayOf('2026-11-16')).toBe(1)
    expect(weekdayOf(TODAY)).toBe(6)
    expect(weekdayOf('2026-11-22')).toBe(7)
  })
})

describe('ISO weeks', () => {
  it('assigns days to ISO weeks, including around new year', () => {
    expect(isoWeekKey(TODAY)).toBe('2026-W47')
    expect(isoWeekKey('2026-01-01')).toBe('2026-W01') // a Thursday
    expect(isoWeekKey('2024-12-30')).toBe('2025-W01') // Monday of the week holding Jan 2nd
    expect(isoWeekKey('2027-01-03')).toBe('2026-W53') // Sunday still in 2026's last week
    expect(isoWeekKey('2027-01-04')).toBe('2027-W01')
    expect(isoWeekKey('2021-01-03')).toBe('2020-W53')
  })

  it('knows which years have 53 weeks', () => {
    expect(weeksInYear(2026)).toBe(53)
    expect(weeksInYear(2025)).toBe(52)
    expect(weeksInYear(2020)).toBe(53)
  })

  it('starts weeks on Monday', () => {
    expect(weekStart('2026-W47')).toBe('2026-11-16')
    expect(weekStart('2026-W01')).toBe('2025-12-29')
    expect(weekStart('2026-W53')).toBe('2026-12-28')
    expect(weekDays('2026-W47')).toEqual([
      '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22',
    ])
  })

  it('round-trips every week of several years', () => {
    for (const year of [2020, 2024, 2025, 2026, 2027]) {
      for (let week = 1; week <= weeksInYear(year); week++) {
        const key = `${year}-W${String(week).padStart(2, '0')}`
        for (const day of weekDays(key)) expect(isoWeekKey(day)).toBe(key)
      }
    }
  })

  it('steps between weeks across a year boundary', () => {
    expect(addWeeks('2026-W47', 1)).toBe('2026-W48')
    expect(addWeeks('2026-W53', 1)).toBe('2027-W01')
    expect(addWeeks('2027-W01', -1)).toBe('2026-W53')
    expect(addWeeks('2026-W01', -1)).toBe('2025-W52')
  })
})

describe('months and periods', () => {
  it('steps between months', () => {
    expect(addMonths('2026-11', 1)).toBe('2026-12')
    expect(addMonths('2026-12', 1)).toBe('2027-01')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(addMonths('2026-11', -23)).toBe('2024-12')
  })

  it('lists the days of a month', () => {
    expect(monthDays('2026-11')).toHaveLength(30)
    expect(monthDays('2026-02')).toHaveLength(28)
    expect(monthDays('2028-02').at(-1)).toBe('2028-02-29')
  })

  it('gives the first and last day of a period', () => {
    expect(periodRange('2026-W47')).toEqual({ start: '2026-11-16', end: '2026-11-22' })
    expect(periodRange('2026-11')).toEqual({ start: '2026-11-01', end: '2026-11-30' })
    expect(() => periodRange('2026-11-21')).toThrow(InvalidError)
  })
})

describe('today in a timezone', () => {
  it('depends on the timezone, not on UTC', () => {
    const instant = Date.UTC(2026, 10, 22, 3, 30) // 03:30 UTC on the 22nd
    expect(todayIn('UTC', instant)).toBe('2026-11-22')
    expect(todayIn('America/Chicago', instant)).toBe('2026-11-21') // still the evening before
    expect(todayIn('Asia/Tokyo', instant)).toBe('2026-11-22')
    expect(todayIn('Pacific/Kiritimati', Date.UTC(2026, 11, 31, 12))).toBe('2027-01-01')
  })

  it('rejects unknown timezones', () => {
    expect(() => todayIn('Mars/Olympus_Mons')).toThrow(InvalidError)
  })
})

describe('parsing dates', () => {
  const parse = (input: string) => parseDateInput(input, TODAY)

  it('understands relative days', () => {
    expect(parse('today')).toBe('2026-11-21')
    expect(parse('Tomorrow')).toBe('2026-11-22')
    expect(parse('yesterday')).toBe('2026-11-20')
    expect(parse('+3d')).toBe('2026-11-24')
    expect(parse('+3')).toBe('2026-11-24')
    expect(parse('-1d')).toBe('2026-11-20')
    expect(parse('+2w')).toBe('2026-12-05')
    expect(parse('+0d')).toBe('2026-11-21')
  })

  it('resolves weekday names to the next such day, never today', () => {
    expect(parse('mon')).toBe('2026-11-23')
    expect(parse('Friday')).toBe('2026-11-27')
    expect(parse('sun')).toBe('2026-11-22')
    expect(parse('sat')).toBe('2026-11-28') // today is Saturday → a week from now
  })

  it('understands weeks and months', () => {
    expect(parse('next-week')).toBe('2026-11-23')
    expect(parse('next week')).toBe('2026-11-23')
    expect(parse('this-month')).toBe('2026-11')
    expect(parse('next-month')).toBe('2026-12')
    expect(parseDateInput('next-month', '2026-12-15')).toBe('2027-01')
  })

  it('passes explicit dates through, validated', () => {
    expect(parse('2026-12-24')).toBe('2026-12-24')
    expect(parse(' 2027-01 ')).toBe('2027-01')
    expect(parse('2026-w48')).toBe('2026-W48')
    expect(() => parse('2026-02-30')).toThrow(/not a real calendar date/)
    expect(() => parse('2026-13')).toThrow(InvalidError)
    expect(() => parse('2026-W60')).toThrow(InvalidError)
  })

  it('understands unscheduled', () => {
    for (const word of ['unscheduled', 'someday', 'none', UNSCHEDULED]) {
      expect(parse(word)).toBe(UNSCHEDULED)
    }
  })

  it('rejects anything else with a hint', () => {
    expect(() => parse('')).toThrow(InvalidError)
    expect(() => parse('soonish')).toThrow(/Unrecognized date "soonish"/)
    expect(() => parse('11/21/2026')).toThrow(InvalidError)
  })
})

describe('parsing weeks and months', () => {
  it('parses week arguments', () => {
    expect(parseWeekInput(undefined, TODAY)).toBe('2026-W47')
    expect(parseWeekInput('this', TODAY)).toBe('2026-W47')
    expect(parseWeekInput('+1', TODAY)).toBe('2026-W48')
    expect(parseWeekInput('-1', TODAY)).toBe('2026-W46')
    expect(parseWeekInput('next', TODAY)).toBe('2026-W48')
    expect(parseWeekInput('next-week', TODAY)).toBe('2026-W48')
    expect(parseWeekInput('last', TODAY)).toBe('2026-W46')
    expect(parseWeekInput('2026-w02', TODAY)).toBe('2026-W02')
    expect(parseWeekInput('2026-12-31', TODAY)).toBe('2026-W53')
    expect(() => parseWeekInput('2025-W53', TODAY)).toThrow(InvalidError)
    expect(() => parseWeekInput('2026-11', TODAY)).toThrow(InvalidError)
  })

  it('parses month arguments', () => {
    expect(parseMonthInput(undefined, TODAY)).toBe('2026-11')
    expect(parseMonthInput('+2', TODAY)).toBe('2027-01')
    expect(parseMonthInput('-1', TODAY)).toBe('2026-10')
    expect(parseMonthInput('next-month', TODAY)).toBe('2026-12')
    expect(parseMonthInput('2026-03', TODAY)).toBe('2026-03')
    expect(parseMonthInput('2026-03-15', TODAY)).toBe('2026-03')
    expect(() => parseMonthInput('2026-13', TODAY)).toThrow(InvalidError)
    expect(() => parseMonthInput('March', TODAY)).toThrow(InvalidError)
  })
})
