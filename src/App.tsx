import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
// registerType is 'autoUpdate' — SW auto-updates and reloads on new deploy
import DailyLog from './DailyLog'
import WeeklyLog from './WeeklyLog'
import MonthlyLog from './MonthlyLog'
import TagView from './TagView'
import FutureLog from './FutureLog'
import TaskDetail from './TaskDetail'
import ShortcutsHelp from './ShortcutsHelp'
import SyncIndicator from './SyncIndicator'
import Toaster from './Toaster'
import { DayIcon, FutureIcon, MonthIcon, TagIcon, WeekIcon } from './Icons'
import { useTags } from './hooks'
import { isoWeekKey, monthKey, type BujoEntry } from './db'
import {
  defaultRoute,
  navigate,
  parseRoute,
  routeHash,
  shiftRoute,
  useRoute,
  VIEWS,
  type View,
} from './router'
import { TagColorsContext } from './tagColors'
import { useToday } from './useToday'
import './App.css'

const VIEW_META: Record<View, { label: string; icon: ReactNode }> = {
  daily: { label: 'Daily', icon: <DayIcon /> },
  weekly: { label: 'Weekly', icon: <WeekIcon /> },
  monthly: { label: 'Monthly', icon: <MonthIcon /> },
  future: { label: 'Future', icon: <FutureIcon /> },
  tags: { label: 'Tags', icon: <TagIcon /> },
}

/** A swipe has to be this long, quick, and mostly horizontal to turn the page */
const SWIPE_MIN_PX = 70
const SWIPE_MAX_MS = 600
/** Touches starting this close to a screen edge belong to the browser's own back gesture */
const SWIPE_EDGE_PX = 24

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
}

export default function App() {
  const route = useRoute()
  const today = useToday()
  const [detailEntry, setDetailEntry] = useState<BujoEntry | null>(null)
  const [showHelp, setShowHelp] = useState(false)
  useRegisterSW()

  const tags = useTags()
  const tagColors = useMemo(() => new Map((tags ?? []).map((t) => [t.name, t.color])), [tags])

  // ─── Navigation ──────────────────────────────────────────────────

  // Each view remembers where it was, so switching tabs and back does not
  // lose the day (or week, or tag) being looked at.
  const lastHash = useRef<Partial<Record<View, string>>>({})
  useEffect(() => {
    lastHash.current[route.view] = routeHash(route)
  }, [route])

  const goToView = useCallback(
    (view: View) => {
      const remembered = lastHash.current[view]
      // Choosing the view you are already on means "take me back to now".
      if (view === route.view || !remembered) navigate(defaultRoute(view))
      else navigate(parseRoute(remembered))
    },
    [route.view],
  )

  const shift = useCallback(
    (dir: number) => {
      const next = shiftRoute(route, dir, today)
      if (next) navigate(next, { replace: true })
    },
    [route, today],
  )

  const navigateToTag = useCallback((tag: string) => navigate({ view: 'tags', tag }), [])

  // ─── Details panel ───────────────────────────────────────────────

  // Opening the panel adds a history entry, so the browser's (and Android's)
  // Back button closes it instead of leaving the page.
  const detailInHistory = useRef(false)

  const openDetail = useCallback((entry: BujoEntry) => {
    window.history.pushState({ detail: true }, '')
    detailInHistory.current = true
    setDetailEntry(entry)
  }, [])

  const closeDetail = useCallback(() => {
    setDetailEntry(null)
    if (detailInHistory.current) {
      detailInHistory.current = false
      window.history.back()
    }
  }, [])

  useEffect(() => {
    const onPopState = () => {
      if (detailInHistory.current && !window.history.state?.detail) {
        detailInHistory.current = false
        setDetailEntry(null)
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  // ─── Keyboard shortcuts ──────────────────────────────────────────

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      if (isTyping(e.target) || document.querySelector('dialog[open]')) return

      const viewIndex = Number(e.key) - 1
      if (VIEWS[viewIndex]) {
        goToView(VIEWS[viewIndex])
      } else if (e.key === 'ArrowLeft') {
        shift(-1)
      } else if (e.key === 'ArrowRight') {
        shift(1)
      } else if (e.key === 't' || e.key === 'T') {
        navigate(defaultRoute(route.view), { replace: true })
      } else if (e.key === 'n' || e.key === 'N') {
        document.querySelector<HTMLInputElement>('[data-composer]')?.focus()
      } else if (e.key === '?') {
        setShowHelp(true)
      } else {
        return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [goToView, shift, route.view])

  // ─── Swipe between days / weeks / months ─────────────────────────

  const touch = useRef<{ x: number; y: number; at: number } | null>(null)

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0]
    const nearEdge = t.clientX < SWIPE_EDGE_PX || t.clientX > window.innerWidth - SWIPE_EDGE_PX
    touch.current =
      e.touches.length === 1 && !nearEdge && !isTyping(e.target) ? { x: t.clientX, y: t.clientY, at: e.timeStamp } : null
  }

  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touch.current
    touch.current = null
    if (!start) return
    const t = e.changedTouches[0]
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy) * 2 && e.timeStamp - start.at <= SWIPE_MAX_MS) {
      shift(dx < 0 ? 1 : -1)
    }
  }

  // ─── Render ──────────────────────────────────────────────────────

  let content: ReactNode
  switch (route.view) {
    case 'daily':
      content = (
        <DailyLog date={route.date ?? today} today={today} onOpenDetail={openDetail} onTagClick={navigateToTag} />
      )
      break
    case 'weekly':
      content = (
        <WeeklyLog
          week={route.week ?? isoWeekKey(today)}
          today={today}
          onOpenDetail={openDetail}
          onTagClick={navigateToTag}
        />
      )
      break
    case 'monthly':
      content = (
        <MonthlyLog
          month={route.month ?? monthKey(today)}
          today={today}
          onOpenDetail={openDetail}
          onTagClick={navigateToTag}
        />
      )
      break
    case 'future':
      content = <FutureLog onOpenDetail={openDetail} onTagClick={navigateToTag} />
      break
    case 'tags':
      content = <TagView tag={route.tag} onOpenDetail={openDetail} onTagClick={navigateToTag} />
      break
  }

  return (
    <TagColorsContext.Provider value={tagColors}>
      <div className="app" data-view={route.view}>
        <header className="app-bar">
          <a className="app-title" href={routeHash(defaultRoute('daily'))} title="Today">
            BuJo <span className="app-version">v{__APP_VERSION__}</span>
          </a>

          <nav className="view-nav" aria-label="Views">
            {VIEWS.map((view, i) => (
              <a
                key={view}
                href={routeHash(defaultRoute(view))}
                aria-current={route.view === view ? 'page' : undefined}
                title={`${VIEW_META[view].label} (${i + 1})`}
                onClick={(e) => {
                  // Leave "open in new tab" and friends to the browser
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
                  e.preventDefault()
                  goToView(view)
                }}
              >
                {VIEW_META[view].icon}
                <span>{VIEW_META[view].label}</span>
              </a>
            ))}
          </nav>

          <div className="app-bar-end">
            <SyncIndicator />
            <button
              type="button"
              className="help-btn"
              onClick={() => setShowHelp(true)}
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts (?)"
            >
              ?
            </button>
          </div>
        </header>

        <main
          className="app-main"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          {content}
        </main>

        <Toaster />
        {detailEntry && <TaskDetail entry={detailEntry} today={today} onClose={closeDetail} />}
        {showHelp && <ShortcutsHelp onClose={() => setShowHelp(false)} />}
      </div>
    </TagColorsContext.Provider>
  )
}
