import { useState, useCallback } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
// registerType is 'autoUpdate' — SW auto-updates and reloads on new deploy
import DailyLog from './DailyLog'
import WeeklyLog from './WeeklyLog'
import MonthlyLog from './MonthlyLog'
import TagView from './TagView'
import FutureLog from './FutureLog'
import TaskDetail from './TaskDetail'
import { useSyncStatus } from './hooks'
import type { SyncState } from './hooks'
import type { BujoEntry } from './db'
import './App.css'

const syncLabels: Record<SyncState, string> = {
  synced: 'Synced',
  syncing: 'Syncing',
  offline: 'Offline',
  error: 'Sync error',
  denied: 'Access denied',
  'auth-required': 'Login required',
}

function SyncIndicator() {
  const { state, error } = useSyncStatus()

  const reAuthenticate = async () => {
    // The service worker binds all navigations to the cached index.html, so a
    // plain reload never reaches Cloudflare and the Access login page can't
    // challenge the user. Unregister the SW and clear its caches so the next
    // navigation goes over the wire. PouchDB data (IndexedDB) is untouched,
    // and the SW re-registers on the next load via useRegisterSW().
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations()
        await Promise.all(regs.map((r) => r.unregister()))
      }
      if ('caches' in window) {
        const keys = await caches.keys()
        await Promise.all(keys.map((k) => caches.delete(k)))
      }
    } catch {
      // Fall through and attempt the navigation anyway.
    }
    // Cache-bust query param so HTTP cache can't serve a stale shell either.
    window.location.href = `${window.location.origin}/?reauth=${Date.now()}`
  }

  return (
    <div className={`sync-indicator sync-${state}`} title={error ?? syncLabels[state]}>
      <span className="sync-dot" />
      <span className="sync-label">{syncLabels[state]}</span>
      {state === 'auth-required' && (
        <button className="sync-reauth-btn" onClick={reAuthenticate}>
          Log in
        </button>
      )}
    </div>
  )
}

type View = 'daily' | 'weekly' | 'monthly' | 'future' | 'tags'

export default function App() {
  const [view, setView] = useState<View>('daily')
  const [dailyDate, setDailyDate] = useState<string | null>(null)
  const [detailEntry, setDetailEntry] = useState<BujoEntry | null>(null)
  useRegisterSW()

  const navigateToDay = useCallback((date: string) => {
    setDailyDate(date)
    setView('daily')
  }, [])

  const openDetail = useCallback((entry: BujoEntry) => {
    setDetailEntry(entry)
  }, [])

  const closeDetail = useCallback(() => {
    setDetailEntry(null)
  }, [])

  const [selectedTag, setSelectedTag] = useState<string | null>(null)

  const navigateToTag = useCallback((tagName: string) => {
    setSelectedTag(tagName)
    setView('tags')
  }, [])

  return (
    <main className="app">
      <div className="app-header">
        <h1 className="app-title">
          BuJo <span className="app-version">v{__APP_VERSION__}</span>
        </h1>
        <SyncIndicator />
      </div>

      <nav className="view-nav">
        <button
          className={view === 'daily' ? 'active' : ''}
          onClick={() => setView('daily')}
        >
          Daily
        </button>
        <button
          className={view === 'weekly' ? 'active' : ''}
          onClick={() => setView('weekly')}
        >
          Weekly
        </button>
        <button
          className={view === 'monthly' ? 'active' : ''}
          onClick={() => setView('monthly')}
        >
          Monthly
        </button>
        <button
          className={view === 'future' ? 'active' : ''}
          onClick={() => setView('future')}
        >
          Future
        </button>
        <button
          className={view === 'tags' ? 'active' : ''}
          onClick={() => setView('tags')}
        >
          Tags
        </button>
      </nav>

      {view === 'daily' && <DailyLog initialDate={dailyDate} onOpenDetail={openDetail} onTagClick={navigateToTag} />}
      {view === 'weekly' && <WeeklyLog onNavigateToDay={navigateToDay} onOpenDetail={openDetail} onTagClick={navigateToTag} />}
      {view === 'monthly' && <MonthlyLog onNavigateToDay={navigateToDay} onTagClick={navigateToTag} />}
      {view === 'future' && <FutureLog onOpenDetail={openDetail} onTagClick={navigateToTag} />}
      {view === 'tags' && <TagView onOpenDetail={openDetail} onTagClick={navigateToTag} initialTag={selectedTag} onClearInitialTag={() => setSelectedTag(null)} />}

      {detailEntry && <TaskDetail entry={detailEntry} onClose={closeDetail} />}
    </main>
  )
}
