// Where the app is, kept in the URL hash so a reload, a shared link and the
// back button all land in the right place:
//
//   #/daily              today (follows the clock)
//   #/daily/2026-11-22   a given day
//   #/weekly/2026-W47    #/monthly/2026-11
//   #/future             #/tags            #/tags/work
//
// A hash needs nothing from the server and survives the service worker's
// "every navigation is index.html" rule.

import { useMemo, useSyncExternalStore } from 'react'
import {
  addDays,
  addMonths,
  addWeeks,
  isDayDate,
  isMonthKey,
  isWeekKey,
  isoWeekKey,
  monthKey,
} from '@bujo/core'

export type View = 'daily' | 'weekly' | 'monthly' | 'future' | 'tags'

export const VIEWS: View[] = ['daily', 'weekly', 'monthly', 'future', 'tags']

/** A null date, week or month means "the current one". */
export type Route =
  | { view: 'daily'; date: string | null }
  | { view: 'weekly'; week: string | null }
  | { view: 'monthly'; month: string | null }
  | { view: 'future' }
  | { view: 'tags'; tag: string | null }

export function defaultRoute(view: View): Route {
  switch (view) {
    case 'daily':
      return { view, date: null }
    case 'weekly':
      return { view, week: null }
    case 'monthly':
      return { view, month: null }
    case 'future':
      return { view }
    case 'tags':
      return { view, tag: null }
  }
}

export function parseRoute(hash: string): Route {
  const [view, arg] = hash.replace(/^#\/?/, '').split('/')
  switch (view) {
    case 'weekly':
      return { view, week: arg && isWeekKey(arg) ? arg : null }
    case 'monthly':
      return { view, month: arg && isMonthKey(arg) ? arg : null }
    case 'future':
      return { view }
    case 'tags': {
      let tag: string | null = null
      try {
        tag = arg ? decodeURIComponent(arg).toLowerCase() : null
      } catch {
        // A malformed escape: show the tag list.
      }
      return { view, tag }
    }
    default:
      return { view: 'daily', date: arg && isDayDate(arg) ? arg : null }
  }
}

export function routeHash(route: Route): string {
  switch (route.view) {
    case 'daily':
      return route.date ? `#/daily/${route.date}` : '#/daily'
    case 'weekly':
      return route.week ? `#/weekly/${route.week}` : '#/weekly'
    case 'monthly':
      return route.month ? `#/monthly/${route.month}` : '#/monthly'
    case 'future':
      return '#/future'
    case 'tags':
      return route.tag ? `#/tags/${encodeURIComponent(route.tag)}` : '#/tags'
  }
}

/** Routes for a specific day, week or month; the current one is stored as null so it follows the clock. */
export function dayRoute(date: string, today: string): Route {
  return { view: 'daily', date: date === today ? null : date }
}

export function weekRoute(week: string, today: string): Route {
  return { view: 'weekly', week: week === isoWeekKey(today) ? null : week }
}

export function monthRoute(month: string, today: string): Route {
  return { view: 'monthly', month: month === monthKey(today) ? null : month }
}

/** Where an entry dated `date` lives: its day, its month, or the future log. */
export function routeForDate(date: string, today: string): Route {
  if (isDayDate(date)) return dayRoute(date, today)
  if (isMonthKey(date)) return monthRoute(date, today)
  return { view: 'future' }
}

/** The previous (-1) or next (+1) day, week or month; null for views without one. */
export function shiftRoute(route: Route, dir: number, today: string): Route | null {
  switch (route.view) {
    case 'daily':
      return dayRoute(addDays(route.date ?? today, dir), today)
    case 'weekly':
      return weekRoute(addWeeks(route.week ?? isoWeekKey(today), dir), today)
    case 'monthly':
      return monthRoute(addMonths(route.month ?? monthKey(today), dir), today)
    default:
      return null
  }
}

const ROUTE_EVENT = 'bujo:route'

/**
 * Go to a route. A plain navigation adds a history entry (so Back returns);
 * `replace` swaps the current one — used for stepping day by day, which would
 * otherwise bury the previous view under dozens of entries.
 */
export function navigate(route: Route, options: { replace?: boolean } = {}): void {
  const hash = routeHash(route)
  if (hash === window.location.hash) return
  if (options.replace) window.history.replaceState(null, '', hash)
  else window.history.pushState(null, '', hash)
  window.dispatchEvent(new Event(ROUTE_EVENT))
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange)
  window.addEventListener('hashchange', onChange)
  window.addEventListener(ROUTE_EVENT, onChange)
  return () => {
    window.removeEventListener('popstate', onChange)
    window.removeEventListener('hashchange', onChange)
    window.removeEventListener(ROUTE_EVENT, onChange)
  }
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash)
  return useMemo(() => parseRoute(hash), [hash])
}
