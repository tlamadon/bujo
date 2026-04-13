import { useState, useEffect } from 'react'
import {
  localDb,
  sync,
  getEntriesForDate,
  getEntriesForDateRange,
  getAllTags,
  getEntriesForTag,
  getUnscheduledEntries,
  type DisplayEntry,
  type TagDoc,
  type BujoEntry,
} from './db'

export type SyncState = 'synced' | 'syncing' | 'offline' | 'error' | 'denied' | 'auth-required'

export interface SyncStatus {
  state: SyncState
  error?: string
}

type RemoteStatus = 'reachable' | 'auth-required' | 'offline'

async function checkRemote(): Promise<RemoteStatus> {
  try {
    const resp = await fetch(`${window.location.origin}/couchdb/bujo`, { method: 'HEAD' })
    // Cloudflare Access redirects to its login page when auth expires.
    // Detect this by checking if the response was redirected away from our origin,
    // or if we got an HTML response instead of JSON from CouchDB.
    if (resp.redirected && new URL(resp.url).origin !== window.location.origin) {
      return 'auth-required'
    }
    // Cloudflare may also return 403 with its own HTML page
    if (resp.status === 403) {
      const ct = resp.headers.get('content-type') ?? ''
      if (ct.includes('text/html')) return 'auth-required'
    }
    return resp.ok ? 'reachable' : 'offline'
  } catch {
    return 'offline'
  }
}

/** Reactive hook: tracks PouchDB sync status */
export function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>({ state: 'syncing' })

  useEffect(() => {
    const onActive = () => {
      setStatus({ state: 'syncing' })
    }

    const resolveStatus = (remote: RemoteStatus, fallbackState: SyncState, msg?: string): SyncStatus => {
      if (remote === 'auth-required') return { state: 'auth-required', error: 'Session expired — re-authenticate to sync' }
      if (remote === 'offline') return { state: 'offline', error: 'Cannot reach server' }
      return msg ? { state: fallbackState, error: msg } : { state: fallbackState }
    }

    // 'paused' fires when replication is caught up and idle
    const onPaused = (err: unknown) => {
      const msg = err instanceof Error ? err.message : err ? 'Sync error' : undefined
      checkRemote().then((remote) => {
        setStatus(resolveStatus(remote, msg ? 'error' : 'synced', msg))
      })
    }

    const onError = (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Sync error'
      checkRemote().then((remote) => {
        setStatus(resolveStatus(remote, 'error', msg))
      })
    }

    const onDenied = () => {
      checkRemote().then((remote) => {
        if (remote === 'auth-required') {
          setStatus({ state: 'auth-required', error: 'Session expired — re-authenticate to sync' })
        } else {
          setStatus({ state: 'denied', error: 'Access denied' })
        }
      })
    }

    sync.on('active', onActive)
    sync.on('paused', onPaused)
    sync.on('error', onError)
    sync.on('denied', onDenied)

    // Check initial connectivity
    checkRemote().then((remote) => {
      if (remote === 'auth-required') setStatus({ state: 'auth-required', error: 'Session expired — re-authenticate to sync' })
      else if (remote === 'offline') setStatus({ state: 'offline', error: 'Cannot reach server' })
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

    const changes = localDb.changes({ since: 'now', live: true })
    changes.on('change', () => load())

    return () => {
      cancelled = true
      changes.cancel()
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

    const changes = localDb.changes({ since: 'now', live: true })
    changes.on('change', () => load())

    return () => {
      cancelled = true
      changes.cancel()
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

    const changes = localDb.changes({ since: 'now', live: true })
    changes.on('change', () => load())

    return () => {
      cancelled = true
      changes.cancel()
    }
  }, [])

  return entries
}
