import { useState, useEffect } from 'react'
import {
  localDb,
  sync,
  getEntriesForDate,
  getEntriesForDateRange,
  type DisplayEntry,
} from './db'

export type SyncState = 'synced' | 'syncing' | 'offline' | 'error' | 'denied'

export interface SyncStatus {
  state: SyncState
  error?: string
}

async function checkRemote(): Promise<boolean> {
  try {
    const resp = await fetch(`${window.location.origin}/couchdb/bujo`, { method: 'HEAD' })
    return resp.ok
  } catch {
    return false
  }
}

/** Reactive hook: tracks PouchDB sync status */
export function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>({ state: 'syncing' })

  useEffect(() => {
    const onActive = () => {
      setStatus({ state: 'syncing' })
    }

    // 'paused' fires when replication is caught up and idle
    const onPaused = (err: unknown) => {
      if (err) {
        const msg = err instanceof Error ? err.message : 'Sync error'
        checkRemote().then((reachable) => {
          setStatus(reachable
            ? { state: 'error', error: msg }
            : { state: 'offline', error: 'Cannot reach server' })
        })
      } else {
        checkRemote().then((reachable) => {
          setStatus(reachable
            ? { state: 'synced' }
            : { state: 'offline', error: 'Cannot reach server' })
        })
      }
    }

    const onError = (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Sync error'
      checkRemote().then((reachable) => {
        setStatus(reachable
          ? { state: 'error', error: msg }
          : { state: 'offline', error: 'Cannot reach server' })
      })
    }

    const onDenied = () => {
      setStatus({ state: 'denied', error: 'Access denied' })
    }

    sync.on('active', onActive)
    sync.on('paused', onPaused)
    sync.on('error', onError)
    sync.on('denied', onDenied)

    // Check initial connectivity
    checkRemote().then((reachable) => {
      if (!reachable) setStatus({ state: 'offline', error: 'Cannot reach server' })
    })

    return () => {
      sync.removeListener('active', onActive)
      sync.removeListener('paused', onPaused)
      sync.removeListener('error', onError)
      sync.removeListener('denied', onDenied)
    }
  }, [])

  return status
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

    const changes = localDb.changes({ since: 'now', live: true })
    changes.on('change', () => load())

    return () => {
      cancelled = true
      changes.cancel()
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

    const changes = localDb.changes({ since: 'now', live: true })
    changes.on('change', () => load())

    return () => {
      cancelled = true
      changes.cancel()
    }
  }, [startDate, endDate])

  return entries
}
