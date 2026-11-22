import { useRef } from 'react'
import { isDayDate } from '@bujo/core'
import { ChevronLeft, ChevronRight } from './Icons'

// Where `showPicker()` is missing (older Safari and Firefox), the date input
// is laid over the title instead and takes the tap itself.
const HAS_SHOW_PICKER = typeof HTMLInputElement !== 'undefined' && 'showPicker' in HTMLInputElement.prototype

interface Props {
  title: string
  /** "Today", "3 days ago", "Next week"… */
  relative: string
  /** What Previous / Next step by, for their labels */
  unit: 'day' | 'week' | 'month'
  /** Whether this is the current day, week or month */
  isCurrent: boolean
  /** A day in the period shown: where the date picker opens */
  pickerValue: string
  onPrev: () => void
  onNext: () => void
  onCurrent: () => void
  /** The user picked a day in the date picker */
  onPick: (day: string) => void
}

const CURRENT_LABEL = { day: 'Today', week: 'This week', month: 'This month' }

/** The heading of a dated view: previous / next, a title that opens a date picker, and a way back to now. */
export default function PeriodHeader({
  title,
  relative,
  unit,
  isCurrent,
  pickerValue,
  onPrev,
  onNext,
  onCurrent,
  onPick,
}: Props) {
  const pickerRef = useRef<HTMLInputElement>(null)

  const openPicker = () => {
    const input = pickerRef.current
    if (!input) return
    try {
      input.showPicker()
    } catch {
      input.focus()
    }
  }

  return (
    <header className="period-header">
      <button type="button" className="icon-btn" onClick={onPrev} aria-label={`Previous ${unit}`} title={`Previous ${unit} (←)`}>
        <ChevronLeft />
      </button>
      <div className="period-center">
        <h2 className="period-title">
          <span className={`date-jump ${HAS_SHOW_PICKER ? '' : 'date-jump-overlay'}`}>
            <button type="button" className="date-jump-btn" onClick={openPicker} title="Jump to a date">
              {title}
            </button>
            <input
              ref={pickerRef}
              type="date"
              className="date-jump-input"
              value={pickerValue}
              onChange={(e) => {
                if (isDayDate(e.target.value)) onPick(e.target.value)
              }}
              tabIndex={-1}
              aria-label="Jump to a date"
            />
          </span>
        </h2>
        <p className="period-sub">
          <span>{relative}</span>
          {!isCurrent && (
            <button type="button" className="today-btn" onClick={onCurrent} title={`${CURRENT_LABEL[unit]} (T)`}>
              {CURRENT_LABEL[unit]}
            </button>
          )}
        </p>
      </div>
      <button type="button" className="icon-btn" onClick={onNext} aria-label={`Next ${unit}`} title={`Next ${unit} (→)`}>
        <ChevronRight />
      </button>
    </header>
  )
}
