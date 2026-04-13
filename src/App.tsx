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

  const reAuthenticate = () => {
    // Navigate to origin to trigger Cloudflare Access login flow.
    // Using window.location.href (not reload) to ensure the request
    // goes through Cloudflare rather than being served by the service worker.
    window.location.href = window.location.origin
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
        <h1 className="app-title">BuJo</h1>
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
