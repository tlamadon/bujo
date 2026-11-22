// What the sync is doing, and — when it is not working — why.
//
// A module-level store rather than state inside a component: the status has
// to survive the indicator re-mounting, and it drives recovery (restarting a
// replication PouchDB has abandoned), which must not depend on what is on
// screen.

import { useSyncExternalStore } from 'react'
import { restartSync, subscribeSync, type SyncDirection, type SyncEvent } from './db'

export type SyncState = 'synced' | 'syncing' | 'offline' | 'error' | 'denied' | 'auth-required'

export interface SyncProblem {
  /** What went wrong, in a sentence */
  summary: string
  /** What that means for the user, and what to do about it */
  explanation: string
  /** The raw facts, to copy into a bug report */
  technical: string
}

export interface SyncStatus {
  state: SyncState
  problem?: SyncProblem
  /** When the local and remote databases were last known to be level */
  lastSyncedAt?: number
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

// ─── What the replications are doing ───────────────────────────────

/**
 * `failing`: a request failed and PouchDB is retrying by itself.
 * `stopped`: PouchDB gave up (it does not retry a 401/403); only
 * `restartSync` resumes it. `retrying`: restarted after that, outcome not in yet.
 */
type Phase = 'active' | 'idle' | 'failing' | 'stopped' | 'retrying'

interface Failure {
  direction: SyncDirection | null
  error: unknown
  at: number
}

const phases: Record<SyncDirection, Phase> = { push: 'active', pull: 'active' }
let failure: Failure | null = null
/** Documents the server refused one by one (replication carries on without them) */
let denied: { direction: SyncDirection | null; info: unknown; at: number } | null = null
let remote: RemoteStatus = 'reachable'
let lastEventAt = Date.now()
let lastSyncedAt: number | undefined

/** With nothing heard for this long, "syncing" is taken to mean "done": iOS Safari swallows events. */
const STALE_SYNCING_MS = 10_000
const POLL_MS = 15_000
const RETRY_FIRST_MS = 15_000
const RETRY_MAX_MS = 5 * 60_000

let retryDelay = RETRY_FIRST_MS
let retryTimer: number | undefined

function isStopped(): boolean {
  return phases.push === 'stopped' || phases.pull === 'stopped'
}

function onSyncEvent(event: SyncEvent): void {
  lastEventAt = Date.now()
  switch (event.type) {
    case 'active':
      // While a failure is being retried, only reaching 'idle' shows it is
      // over: 'active' is also how every failed attempt begins.
      if (phases[event.direction] === 'idle') phases[event.direction] = 'active'
      break
    case 'idle':
      phases[event.direction] = 'idle'
      if (failure && (failure.direction === event.direction || failure.direction === null)) failure = null
      break
    case 'problem': {
      failure = { direction: event.direction, error: event.error, at: Date.now() }
      const phase: Phase = event.fatal ? 'stopped' : 'failing'
      if (event.direction) phases[event.direction] = phase
      else phases.push = phases.pull = phase
      break
    }
    case 'denied':
      denied = { direction: event.direction, info: event.info, at: Date.now() }
      break
    case 'restart':
      for (const direction of ['push', 'pull'] as const) {
        // Keep showing a known failure until the new attempt says otherwise.
        phases[direction] = phases[direction] === 'stopped' || phases[direction] === 'failing' ? 'retrying' : 'active'
      }
      denied = null
      break
  }
  publish()
  refreshRemote()
  scheduleRetry()
}

/** A replication PouchDB has abandoned is started again: soon at first, then less and less often. */
function scheduleRetry(): void {
  if (!isStopped()) return
  if (retryTimer !== undefined) return
  retryTimer = window.setTimeout(() => {
    retryTimer = undefined
    retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS)
    if (isStopped()) restartSync()
  }, retryDelay)
}

/** Try again now (the "Try again" button, or the connection coming back). */
export function retrySync(): void {
  window.clearTimeout(retryTimer)
  retryTimer = undefined
  retryDelay = RETRY_FIRST_MS
  restartSync()
}

function refreshRemote(): void {
  checkRemote().then((next) => {
    const cameBack = remote !== 'reachable' && next === 'reachable'
    remote = next
    // Signed in again, or back online: do not wait out the retry delay.
    if (cameBack && isStopped()) retrySync()
    else publish()
  })
}

// ─── Saying what is wrong ──────────────────────────────────────────

interface ErrorFacts {
  status?: number
  name?: string
  message?: string
}

/** PouchDB's stand-in when the server gave no reason. It says nothing: drop it. */
const GENERIC_MESSAGE = /^batch processing terminated with error$/i

function factsOf(error: unknown): ErrorFacts {
  if (typeof error === 'string') return { message: error }
  if (!error || typeof error !== 'object') return {}
  const e = error as Record<string, unknown>
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined)
  const message = text(e.reason) ?? text(e.message)
  return {
    status: typeof e.status === 'number' ? e.status : undefined,
    name: text(e.name) ?? text(e.error),
    message: message && !GENERIC_MESSAGE.test(message) ? message : undefined,
  }
}

function isAuthFailure(facts: ErrorFacts): boolean {
  const name = facts.name?.toLowerCase()
  return facts.status === 401 || facts.status === 403 || name === 'unauthorized' || name === 'forbidden'
}

const SAFE = 'Your entries are saved on this device and will upload once this is sorted out.'

function technical(state: SyncState, lines: (string | undefined | null | false)[]): string {
  return [
    `state: ${state}`,
    ...lines.filter((line): line is string => !!line),
    `server: ${window.location.origin}/couchdb/bujo`,
    `app: v${__APP_VERSION__}`,
  ].join('\n')
}

function describeFailure(state: SyncState, f: Failure, stopped: boolean): SyncProblem {
  const facts = factsOf(f.error)
  const http = facts.status ? ` (HTTP ${facts.status}${facts.name ? ` ${facts.name}` : ''})` : ''
  const sending = f.direction !== 'pull'

  let summary: string
  let explanation: string
  if (isAuthFailure(facts)) {
    summary = sending
      ? `The server refused to save your changes${http}.`
      : `The server refused to send its changes${http}.`
    // A server that explains itself (see the middleware's NO_IDENTITY) needs no guessing on top.
    explanation = facts.message
      ? SAFE
      : 'It answers, but does not accept this browser as a signed-in user. That happens when the app is opened ' +
        'at an address that does not go through Cloudflare Access (which is what tells the server who you are), ' +
        `or when the Access session has run out. ${SAFE}`
  } else if (facts.status) {
    summary = `The server reported an error while ${sending ? 'saving your changes' : 'sending its changes'}${http}.`
    explanation = SAFE
  } else {
    summary = `A sync request failed while ${sending ? 'sending your changes' : 'fetching changes'}.`
    explanation = SAFE
  }
  if (facts.message) summary += ` It said: “${facts.message}”`
  explanation += stopped ? ' Sync is paused and is retried every so often.' : ' Retrying automatically.'

  return {
    summary,
    explanation,
    technical: technical(state, [
      `when: ${new Date(f.at).toISOString()}`,
      f.direction && `direction: ${f.direction}`,
      facts.status !== undefined && `http status: ${facts.status}`,
      facts.name && `error: ${facts.name}`,
      facts.message && `message: ${facts.message}`,
      `retrying: ${stopped ? 'after a pause' : 'yes'}`,
    ]),
  }
}

function describeDenied(state: SyncState): SyncProblem {
  const doc = ((denied?.info as { doc?: unknown } | null)?.doc ?? denied?.info) as Record<string, unknown> | undefined
  const facts = factsOf(doc)
  const id = typeof doc?.id === 'string' ? doc.id : undefined
  return {
    summary: `The server refused ${id ? `the entry ${id}` : 'some entries'}${facts.message ? `: “${facts.message}”` : '.'}`,
    explanation: `The rest keeps syncing. ${SAFE}`,
    technical: technical(state, [
      denied && `when: ${new Date(denied.at).toISOString()}`,
      denied?.direction && `direction: ${denied.direction}`,
      id && `document: ${id}`,
      facts.status !== undefined && `http status: ${facts.status}`,
      facts.name && `error: ${facts.name}`,
      facts.message && `message: ${facts.message}`,
    ]),
  }
}

function compute(): SyncStatus {
  const now = Date.now()
  const status = (state: SyncState, problem?: SyncProblem): SyncStatus => ({ state, problem, lastSyncedAt })

  if (remote === 'auth-required') {
    return status('auth-required', {
      summary: 'Your sign-in has expired.',
      explanation: 'Log in again to resume syncing. Nothing is lost: your entries are saved on this device.',
      technical: technical('auth-required', ['the server answered with a login page instead of data']),
    })
  }
  if (remote === 'offline') {
    return status('offline', {
      summary: 'The server cannot be reached.',
      explanation: 'Your entries are saved on this device and sync when the connection is back.',
      technical: technical('offline', [`browser online: ${navigator.onLine}`]),
    })
  }

  const phaseList = [phases.push, phases.pull]
  if (failure && phaseList.some((p) => p === 'stopped' || p === 'retrying' || p === 'failing')) {
    const stopped = phaseList.some((p) => p === 'stopped' || p === 'retrying')
    const state: SyncState = isAuthFailure(factsOf(failure.error)) ? 'denied' : 'error'
    return status(state, describeFailure(state, failure, stopped))
  }
  if (denied) return status('denied', describeDenied('denied'))

  if (phaseList.includes('active') && now - lastEventAt <= STALE_SYNCING_MS) return status('syncing')

  lastSyncedAt = now
  return status('synced')
}

// ─── The store ─────────────────────────────────────────────────────

let current: SyncStatus = { state: 'syncing' }
const listeners = new Set<() => void>()

function publish(): void {
  const next = compute()
  const same =
    next.state === current.state &&
    next.problem?.summary === current.problem?.summary &&
    next.problem?.technical === current.problem?.technical &&
    // "Last synced" is shown to the minute
    Math.floor((next.lastSyncedAt ?? 0) / 60_000) === Math.floor((current.lastSyncedAt ?? 0) / 60_000)
  if (same) return
  current = next
  if (next.state === 'synced') retryDelay = RETRY_FIRST_MS
  listeners.forEach((listener) => listener())
}

let started = false

function start(): void {
  if (started) return
  started = true
  subscribeSync(onSyncEvent)
  refreshRemote()
  // The poll catches what events do not: an expired Cloudflare session with
  // nothing to sync, a stuck "syncing", the server coming back.
  window.setInterval(refreshRemote, POLL_MS)
  // iOS Safari suspends background tabs aggressively: look again on return.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshRemote()
  })
  window.addEventListener('online', refreshRemote)
}

function subscribe(listener: () => void): () => void {
  start()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Reactive hook: what the sync is doing */
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribe, () => current)
}
