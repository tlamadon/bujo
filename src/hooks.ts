import { useState, useEffect } from 'react'
import {
  bujo,
  localDb,
  getEntriesForDate,
  getEntriesForDateRange,
  getAllTags,
  getEntriesForTag,
  getEntriesForPeriod,
  getMonthScheduledEntries,
  getUnscheduledEntries,
  type DisplayEntry,
  type TagDoc,
  type BujoEntry,
} from './db'

// One live changes feed for the whole app. Every query hook below re-runs when
// the local database changes; a feed each would mean a dozen listeners on the
// database (PouchDB warns past ten) for what is a single stream of events.
const changeListeners = new Set<() => void>()
let changeFeed: PouchDB.Core.Changes<object> | null = null

function onLocalChange(listener: () => void): () => void {
  changeListeners.add(listener)
  if (!changeFeed) {
    changeFeed = localDb.changes({ since: 'now', live: true })
    changeFeed.on('change', () => changeListeners.forEach((l) => l()))
  }
  return () => {
    changeListeners.delete(listener)
  }
}

/** Reactive hook: all display entries for a given date, auto-updates on local & remote changes */
export function useEntriesForDate(date: string): DisplayEntry[] | undefined {
  const [entries, setEntries] = useState<DisplayEntry[] | undefined>(undefined)

  useEffect(() => {
    let cancelled = false

    const load = () =>
      getEntriesForDate(date).then((docs) => {
        if (!cancelled) setEntries(docs)
      })

    load()

    const stop = onLocalChange(load)

    return () => {
      cancelled = true
      stop()
    }
  }, [date])

  return entries
}

/** Reactive hook: all display entries in a date range [startDate, endDate] */
export function useEntriesForDateRange(
  startDate: string,
  endDate: string,
): DisplayEntry[] | undefined {
  const [entries, setEntries] = useState<DisplayEntry[] | undefined>(undefined)

  useEffect(() => {
    let cancelled = false

    const load = () =>
      getEntriesForDateRange(startDate, endDate).then((docs) => {
        if (!cancelled) setEntries(docs)
      })

    load()

    const stop = onLocalChange(load)

    return () => {
      cancelled = true
      stop()
    }
  }, [startDate, endDate])

  return entries
}

/** Reactive hook: all tag documents */
export function useTags(): TagDoc[] | undefined {
  const [tags, setTags] = useState<TagDoc[] | undefined>(undefined)

  useEffect(() => {
    let cancelled = false

    const load = () =>
      getAllTags().then((docs) => {
        if (!cancelled) setTags(docs)
      })

    load()

    const stop = onLocalChange(load)

    return () => {
      cancelled = true
      stop()
    }
  }, [])

  return tags
}

/** Reactive hook: all entries with a given tag */
export function useEntriesForTag(tagName: string): BujoEntry[] | undefined {
  const [entries, setEntries] = useState<BujoEntry[] | undefined>(undefined)

  useEffect(() => {
    let cancelled = false

    const load = () =>
      getEntriesForTag(tagName).then((docs) => {
        if (!cancelled) setEntries(docs)
      })

    load()

    const stop = onLocalChange(load)

    return () => {
      cancelled = true
      stop()
    }
  }, [tagName])

  return entries
}

/** Reactive hook: all unscheduled entries */
export function useUnscheduledEntries(): BujoEntry[] | undefined {
  const [entries, setEntries] = useState<BujoEntry[] | undefined>(undefined)

  useEffect(() => {
    let cancelled = false

    const load = () =>
      getUnscheduledEntries().then((docs) => {
        if (!cancelled) setEntries(docs)
      })

    load()

    const stop = onLocalChange(load)

    return () => {
      cancelled = true
      stop()
    }
  }, [])

  return entries
}

/** Reactive hook: entries dated to a week (YYYY-Www) or month (YYYY-MM) as a whole */
export function useEntriesForPeriod(period: string): BujoEntry[] | undefined {
  const [entries, setEntries] = useState<BujoEntry[] | undefined>(undefined)

  useEffect(() => {
    let cancelled = false

    const load = () =>
      getEntriesForPeriod(period).then((docs) => {
        if (!cancelled) setEntries(docs)
      })

    load()

    const stop = onLocalChange(load)

    return () => {
      cancelled = true
      stop()
    }
  }, [period])

  return entries
}

/** Reactive hook: future log entries scheduled for a month rather than a day */
export function useMonthScheduledEntries(): BujoEntry[] | undefined {
  const [entries, setEntries] = useState<BujoEntry[] | undefined>(undefined)

  useEffect(() => {
    let cancelled = false

    const load = () =>
      getMonthScheduledEntries().then((docs) => {
        if (!cancelled) setEntries(docs)
      })

    load()

    const stop = onLocalChange(load)

    return () => {
      cancelled = true
      stop()
    }
  }, [])

  return entries
}

/** Reactive hook: how many open tasks sit on days (or months) before `today` */
export function useOverdueCount(today: string): number {
  const [count, setCount] = useState(0)

  useEffect(() => {
    let cancelled = false

    const load = () =>
      bujo.getOverdueTasks(today).then((tasks) => {
        if (!cancelled) setCount(tasks.length)
      })

    load()

    const stop = onLocalChange(load)

    return () => {
      cancelled = true
      stop()
    }
  }, [today])

  return count
}
