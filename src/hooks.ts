import { useState, useEffect } from 'react'
import {
  localDb,
  sync,
  getEntriesForDate,
  getEntriesForDateRange,
  type BujoEntry,
} from './db'

export type SyncState = 'synced' | 'syncing' | 'error' | 'denied'

export interface SyncStatus {
  state: SyncState
  pending: number
  error?: string
}

/** Reactive hook: tracks PouchDB sync status */
export function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>({ state: 'syncing', pending: 0 })

  useEffect(() => {
    const updatePending = async () => {
      try {
        const local = await localDb.info()
        const remote = await (await fetch(`${window.location.origin}/couchdb/bujo`)).json()
        const diff = Math.abs(local.update_seq as number - (remote.update_seq as number))
        return diff
      } catch {
        return 0
      }
    }

    const onActive = () => {
      setStatus((s) => ({ ...s, state: 'syncing' }))
    }

    const onPaused = () => {
      updatePending().then((pending) => {
        setStatus({ state: pending === 0 ? 'synced' : 'syncing', pending })
      })
    }

    const onError = (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Sync error'
      setStatus((s) => ({ state: 'error', pending: s.pending, error: msg }))
    }

    const onDenied = () => {
      setStatus((s) => ({ state: 'denied', pending: s.pending, error: 'Access denied' }))
    }

    sync.on('active', onActive)
    sync.on('paused', onPaused)
    sync.on('error', onError)
    sync.on('denied', onDenied)

    // Check initial state
    onPaused()

    return () => {
      sync.removeListener('active', onActive)
      sync.removeListener('paused', onPaused)
      sync.removeListener('error', onError)
      sync.removeListener('denied', onDenied)
    }
  }, [])

  return status
}

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
