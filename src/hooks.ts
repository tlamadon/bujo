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
    let changeCount = 0

    const onActive = () => {
      changeCount = 0
      setStatus({ state: 'syncing', pending: 0 })
    }

    const onChange = () => {
      changeCount++
      setStatus({ state: 'syncing', pending: changeCount })
    }

    // 'paused' fires when replication is caught up and idle
    const onPaused = (err: unknown) => {
      if (err) {
        const msg = err instanceof Error ? err.message : 'Sync error'
        setStatus({ state: 'error', pending: 0, error: msg })
      } else {
        changeCount = 0
        setStatus({ state: 'synced', pending: 0 })
      }
    }

    const onError = (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Sync error'
      setStatus({ state: 'error', pending: 0, error: msg })
    }

    const onDenied = () => {
      setStatus({ state: 'denied', pending: 0, error: 'Access denied' })
    }

    sync.on('active', onActive)
    sync.on('change', onChange)
    sync.on('paused', onPaused)
    sync.on('error', onError)
    sync.on('denied', onDenied)

    return () => {
      sync.removeListener('active', onActive)
      sync.removeListener('change', onChange)
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
