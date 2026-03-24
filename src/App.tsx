import { useState, useCallback } from 'react'
import DailyLog from './DailyLog'
import WeeklyLog from './WeeklyLog'
import MonthlyLog from './MonthlyLog'
import './App.css'

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
      <h1 className="app-title">BuJo</h1>

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
