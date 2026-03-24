import { useState, useCallback } from 'react'
import DailyLog from './DailyLog'
import WeeklyLog from './WeeklyLog'
import MonthlyLog from './MonthlyLog'
import { useSyncStatus } from './hooks'
import type { SyncState } from './hooks'
import './App.css'

const syncLabels: Record<SyncState, string> = {
  synced: 'Synced',
  syncing: 'Syncing',
  error: 'Sync error',
  denied: 'Access denied',
}

function SyncIndicator() {
  const { state, error } = useSyncStatus()
  return (
    <div className={`sync-indicator sync-${state}`} title={error ?? syncLabels[state]}>
      <span className="sync-dot" />
      <span className="sync-label">{syncLabels[state]}</span>
    </div>
  )
}

type View = 'daily' | 'weekly' | 'monthly'

export default function App() {
  const [view, setView] = useState<View>('daily')
  const [dailyDate, setDailyDate] = useState<string | null>(null)

  const navigateToDay = useCallback((date: string) => {
    setDailyDate(date)
    setView('daily')
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
      </nav>

      {view === 'daily' && <DailyLog initialDate={dailyDate} />}
      {view === 'weekly' && <WeeklyLog onNavigateToDay={navigateToDay} />}
      {view === 'monthly' && <MonthlyLog onNavigateToDay={navigateToDay} />}
    </main>
  )
}
