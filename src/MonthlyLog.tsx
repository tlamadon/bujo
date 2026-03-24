import { useState, useMemo } from 'react'
import { type BujoEntry, type BujoStatus } from './db'
import { useEntriesForDateRange } from './hooks'

const STATUS_ICONS: Record<BujoStatus, string> = {
  task: '•',
  completed: '✕',
  migrated: '>',
  scheduled: '<',
  note: '–',
  event: '○',
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const SHORT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

/** Build a calendar grid (6 weeks max) for a given year/month */
function buildCalendarGrid(year: number, month: number): (string | null)[][] {
  const firstDay = new Date(year, month, 1)
  // Monday=0 ... Sunday=6
  let startDow = firstDay.getDay() - 1
  if (startDow < 0) startDow = 6

  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const weeks: (string | null)[][] = []
  let week: (string | null)[] = new Array(startDow).fill(null)

  for (let day = 1; day <= daysInMonth; day++) {
    week.push(`${year}-${pad(month + 1)}-${pad(day)}`)
    if (week.length === 7) {
      weeks.push(week)
      week = []
    }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null)
    weeks.push(week)
  }
  return weeks
}

interface Props {
  onNavigateToDay: (date: string) => void
}

export default function MonthlyLog({ onNavigateToDay }: Props) {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())

  const firstDate = `${year}-${pad(month + 1)}-01`
  const lastDay = new Date(year, month + 1, 0).getDate()
  const lastDate = `${year}-${pad(month + 1)}-${pad(lastDay)}`

  const entries = useEntriesForDateRange(firstDate, lastDate)

  // Group entries by date
  const byDate = useMemo(() => {
    const map: Record<string, BujoEntry[]> = {}
    if (entries) {
      for (const e of entries) {
        if (!map[e.date]) map[e.date] = []
        map[e.date].push(e)
      }
    }
    return map
  }, [entries])

  const calendarGrid = useMemo(() => buildCalendarGrid(year, month), [year, month])

  // Collect open tasks and events for the task list
  const taskList = useMemo(() => {
    if (!entries) return []
    return entries.filter(
      (e) => e.status === 'task' || e.status === 'event' || e.status === 'scheduled',
    )
  }, [entries])

  const shiftMonth = (dir: number) => {
    setMonth((prev) => {
      let newMonth = prev + dir
      let newYear = year
      if (newMonth < 0) {
        newMonth = 11
        newYear--
      } else if (newMonth > 11) {
        newMonth = 0
        newYear++
      }
      setYear(newYear)
      return newMonth
    })
  }

  const todayStr = toISODate(new Date())

  return (
    <div className="monthly-log">
      <header className="log-header">
        <button onClick={() => shiftMonth(-1)} aria-label="Previous month">
          &larr;
        </button>
        <h2>
          {MONTH_NAMES[month]} {year}
        </h2>
        <button onClick={() => shiftMonth(1)} aria-label="Next month">
          &rarr;
        </button>
      </header>

      {/* Calendar grid */}
      <table className="month-calendar">
        <thead>
          <tr>
            {SHORT_DAYS.map((d) => (
              <th key={d}>{d}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {calendarGrid.map((week, wi) => (
            <tr key={wi}>
              {week.map((date, di) => {
                if (!date) return <td key={di} className="month-cell empty" />
                const dayNum = parseInt(date.slice(-2))
                const dayEntries = byDate[date] || []
                const isToday = date === todayStr
                const hasTask = dayEntries.some((e) => e.status === 'task')
                const hasEvent = dayEntries.some((e) => e.status === 'event')
                return (
                  <td
                    key={di}
                    className={`month-cell ${isToday ? 'today' : ''} ${dayEntries.length > 0 ? 'has-entries' : ''}`}
                    onClick={() => onNavigateToDay(date)}
                    title={`${dayEntries.length} entries`}
                  >
                    <span className="month-day-num">{dayNum}</span>
                    {(hasTask || hasEvent) && (
                      <span className="month-dots">
                        {hasTask && <span className="dot dot-task" />}
                        {hasEvent && <span className="dot dot-event" />}
                      </span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Task list — open tasks and events this month */}
      <div className="month-task-list">
        <h3>Open tasks &amp; events</h3>
        {entries === undefined ? (
          <p className="loading">Loading…</p>
        ) : taskList.length === 0 ? (
          <p className="empty">No open tasks or events this month.</p>
        ) : (
          <ul className="entry-list">
            {taskList.map((entry) => (
              <li key={entry._id} className={`entry status-${entry.status}`}>
                <span className="signifier-static">
                  {STATUS_ICONS[entry.status]}
                </span>
                <span className="month-task-date">{entry.date.slice(5)}</span>
                <span className="body">{entry.body}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
