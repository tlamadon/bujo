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
  const ctrl = new AbortController()
  const timeout = setTimeout(() => ctrl.abort(), 8000)
  try {
    // Follow redirects so we can inspect where we landed. iOS Safari handles
    // redirect: 'manual' poorly for cross-origin redirects (throws instead of
    // returning opaqueredirect), so we follow and inspect the final response.
    const resp = await fetch(`${window.location.origin}/couchdb/bujo`, {
      method: 'GET',
      signal: ctrl.signal,
      cache: 'no-store',
      credentials: 'include',
    })
    // Redirected away from our origin → Cloudflare Access login page.
    if (resp.redirected) {
      try {
        if (new URL(resp.url).origin !== window.location.origin) return 'auth-required'
      } catch {
        return 'auth-required'
      }
    }
    if (resp.status === 401 || resp.status === 403) return 'auth-required'
    // CouchDB root returns JSON. HTML means Cloudflare (or a gateway) intercepted.
    const ct = resp.headers.get('content-type') ?? ''
    if (ct.includes('text/html')) return 'auth-required'
    return resp.ok ? 'reachable' : 'offline'
  } catch {
    // Fetch threw. On iOS this commonly happens when a cross-origin redirect
    // (to cloudflareaccess.com) is blocked by CORS. If the browser says we're
    // online, it's almost certainly an auth issue rather than real offline.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return 'offline'
    }
    return 'auth-required'
  } finally {
    clearTimeout(timeout)
  }
}

/** Reactive hook: tracks PouchDB sync status */
export function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>({ state: 'syncing' })

  useEffect(() => {
    let currentState: SyncState = 'syncing'
    let lastActiveAt = Date.now()

    const update = (s: SyncStatus) => {
      currentState = s.state
      setStatus(s)
    }

    const onActive = () => {
      lastActiveAt = Date.now()
      update({ state: 'syncing' })
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
        update(resolveStatus(remote, msg ? 'error' : 'synced', msg))
      })
    }

    const onError = (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Sync error'
      checkRemote().then((remote) => {
        update(resolveStatus(remote, 'error', msg))
      })
    }

    const onDenied = () => {
      checkRemote().then((remote) => {
        if (remote === 'auth-required') {
          update({ state: 'auth-required', error: 'Session expired — re-authenticate to sync' })
        } else {
          update({ state: 'denied', error: 'Access denied' })
        }
      })
    }

    sync.on('active', onActive)
    sync.on('paused', onPaused)
    sync.on('error', onError)
    sync.on('denied', onDenied)

    // Periodic poll: iOS Safari sometimes swallows PouchDB events (backgrounded
    // tab, failed fetch, etc.), leaving us stuck in 'syncing'. Also detects
    // Cloudflare auth expiry without needing a sync attempt to fail first.
    const poll = () => {
      checkRemote().then((remote) => {
        if (remote === 'auth-required') {
          if (currentState !== 'auth-required') {
            update({ state: 'auth-required', error: 'Session expired — re-authenticate to sync' })
          }
        } else if (remote === 'offline') {
          if (currentState !== 'offline') {
            update({ state: 'offline', error: 'Cannot reach server' })
          }
        } else {
          // Remote reachable. If stuck in 'syncing' with no activity for a while,
          // clear to 'synced' — PouchDB will move us back on the next active event.
          if (currentState === 'syncing' && Date.now() - lastActiveAt > 10000) {
            update({ state: 'synced' })
          } else if (currentState === 'offline' || currentState === 'auth-required') {
            update({ state: 'synced' })
          }
        }
      })
    }

    // Initial check + periodic poll every 15s.
    poll()
    const intervalId = window.setInterval(poll, 15000)

    // Re-check when tab becomes visible (iOS Safari aggressively suspends tabs).
    const onVisibility = () => {
      if (document.visibilityState === 'visible') poll()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      sync.removeListener('active', onActive)
      sync.removeListener('paused', onPaused)
      sync.removeListener('error', onError)
      sync.removeListener('denied', onDenied)
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', onVisibility)
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
