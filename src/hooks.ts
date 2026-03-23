import { useLiveQuery } from 'dexie-react-hooks'
import { db, type BujoEntry } from './db'

/** Live query: all entries for a given date, ordered by creation time */
export function useEntriesForDate(date: string): BujoEntry[] | undefined {
  return useLiveQuery(
    () =>
      db.entries
        .where('date')
        .equals(date)
        .sortBy('createdAt'),
    [date],
  )
}
