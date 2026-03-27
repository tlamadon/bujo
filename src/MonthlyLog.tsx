import { useState, useMemo } from 'react'
import { type BujoStatus, type DisplayEntry } from './db'
import { useEntriesForDateRange } from './hooks'
import { relativeMonthLabel } from './relativeLabel'
import { toISODate } from './dateUtils'

const STATUS_ICONS: Record<BujoStatus, string> = {
  task: '•',
  completed: '✕',
  migrated: '>',
  scheduled: '>',
  note: '–',
  event: '○',
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const SHORT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

/** Build a calendar grid (6 weeks max) for a given year/month */
function buildCalendarGrid(year: number, month: number): (string | null)[][] {
  const firstDay = new Date(year, month, 1)
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

  const rawEntries = useEntriesForDateRange(firstDate, lastDate)

  // Group by display date (skip ghosts for calendar dots — only show real entries)
  const byDate = useMemo(() => {
    const map: Record<string, DisplayEntry[]> = {}
    if (rawEntries) {
      for (const de of rawEntries) {
        if (de.isGhost) continue
        const d = de.entry.date
        if (!map[d]) map[d] = []
        map[d].push(de)
      }
    }
    return map
  }, [rawEntries])

  const calendarGrid = useMemo(() => buildCalendarGrid(year, month), [year, month])

  // Collect open tasks and events for the task list (exclude ghosts)
  const taskList = useMemo(() => {
    if (!rawEntries) return []
    return rawEntries.filter(
      (de) =>
        !de.isGhost &&
        (de.entry.status === 'task' || de.entry.status === 'event' || de.entry.status === 'scheduled'),
    )
  }, [rawEntries])

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
      <div className="relative-label">
        {relativeMonthLabel(year, month)}
        {(year !== now.getFullYear() || month !== now.getMonth()) && (
          <button className="now-btn" onClick={() => { setYear(now.getFullYear()); setMonth(now.getMonth()) }}>Now</button>
        )}
      </div>

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
                const hasOpen = dayEntries.some((de) => de.entry.status === 'task')
                const hasCompleted = dayEntries.some((de) => de.entry.status === 'completed')
                const hasRescheduled = dayEntries.some((de) => de.entry.status === 'scheduled' || de.entry.status === 'migrated')
                const hasNote = dayEntries.some((de) => de.entry.status === 'note')
                const hasEvent = dayEntries.some((de) => de.entry.status === 'event')
                const hasDots = hasOpen || hasCompleted || hasRescheduled || hasNote || hasEvent
                return (
                  <td
                    key={di}
                    className={`month-cell ${isToday ? 'today' : ''} ${dayEntries.length > 0 ? 'has-entries' : ''}`}
                    onClick={() => onNavigateToDay(date)}
                    title={`${dayEntries.length} entries`}
                  >
                    <span className="month-day-num">{dayNum}</span>
                    {hasDots && (
                      <span className="month-dots">
                        {hasOpen && <span className="dot dot-task" />}
                        {hasCompleted && <span className="dot dot-completed" />}
                        {hasRescheduled && <span className="dot dot-rescheduled" />}
                        {hasNote && <span className="dot dot-note" />}
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

      <div className="month-legend">
        <span className="month-legend-item"><span className="dot dot-task" /> Open</span>
        <span className="month-legend-item"><span className="dot dot-completed" /> Done</span>
        <span className="month-legend-item"><span className="dot dot-rescheduled" /> Rescheduled</span>
        <span className="month-legend-item"><span className="dot dot-note" /> Note</span>
        <span className="month-legend-item"><span className="dot dot-event" /> Event</span>
      </div>

      {/* Task list — open tasks and events this month */}
      <div className="month-task-list">
        <h3>Open tasks &amp; events</h3>
        {rawEntries === undefined ? (
          <p className="loading">Loading…</p>
        ) : taskList.length === 0 ? (
          <p className="empty">No open tasks or events this month.</p>
        ) : (
          <ul className="entry-list">
            {taskList.map((de) => (
              <li key={de.entry._id} className={`entry status-${de.entry.status}`}>
                <span className="signifier-static">
                  {STATUS_ICONS[de.entry.status]}
                </span>
                <span className="month-task-date">{de.entry.date.slice(5)}</span>
                <span className="body">{de.entry.body}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
