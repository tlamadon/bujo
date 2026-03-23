import { useState, useEffect } from 'react'
import { localDb, getEntriesForDate, type BujoEntry } from './db'

/** Reactive hook: all entries for a given date, auto-updates on local & remote changes */
export function useEntriesForDate(date: string): BujoEntry[] | undefined {
  const [entries, setEntries] = useState<BujoEntry[] | undefined>(undefined)

  useEffect(() => {
    let cancelled = false

    // Initial fetch
    const load = () =>
      getEntriesForDate(date).then((docs) => {
        if (!cancelled) setEntries(docs)
      })

    load()

    // Listen for any local changes (includes replicated changes from remote)
    const changes = localDb.changes({
      since: 'now',
      live: true,
    })

    changes.on('change', () => {
      load()
    })

    return () => {
      cancelled = true
      changes.cancel()
    }
  }, [date])

  return entries
}
