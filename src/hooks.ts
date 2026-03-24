import { useState, useEffect } from 'react'
import {
  localDb,
  getEntriesForDate,
  getEntriesForDateRange,
  type BujoEntry,
} from './db'

/** Reactive hook: all entries for a given date, auto-updates on local & remote changes */
export function useEntriesForDate(date: string): BujoEntry[] | undefined {
  const [entries, setEntries] = useState<BujoEntry[] | undefined>(undefined)

  useEffect(() => {
    let cancelled = false

    const load = () =>
      getEntriesForDate(date).then((docs) => {
        if (!cancelled) setEntries(docs)
      })

    load()

    const changes = localDb.changes({ since: 'now', live: true })
    changes.on('change', () => load())

    return () => {
      cancelled = true
      changes.cancel()
    }
  }, [date])

  return entries
}

/** Reactive hook: all entries in a date range [startDate, endDate] */
export function useEntriesForDateRange(
  startDate: string,
  endDate: string,
): BujoEntry[] | undefined {
  const [entries, setEntries] = useState<BujoEntry[] | undefined>(undefined)

  useEffect(() => {
    let cancelled = false

    const load = () =>
      getEntriesForDateRange(startDate, endDate).then((docs) => {
        if (!cancelled) setEntries(docs)
      })

    load()

    const changes = localDb.changes({ since: 'now', live: true })
    changes.on('change', () => load())

    return () => {
      cancelled = true
      changes.cancel()
    }
  }, [startDate, endDate])

  return entries
}
