import Dexie, { type EntityTable } from 'dexie'

/** BuJo signifier statuses */
export type BujoStatus =
  | 'task'       // • (bullet)
  | 'completed'  // ✕
  | 'migrated'   // > (moved forward)
  | 'scheduled'  // < (moved to future log)
  | 'note'       // – (dash)
  | 'event'      // ○ (circle)

export interface BujoEntry {
  id?: number
  /** ISO date string YYYY-MM-DD */
  date: string
  status: BujoStatus
  body: string
  createdAt: number
}

class BujoDatabase extends Dexie {
  entries!: EntityTable<BujoEntry, 'id'>

  constructor() {
    super('bujo')
    this.version(1).stores({
      // Compound index [date+status] for fast daily lookups, plus individual indexes
      entries: '++id, [date+status], date, status, createdAt',
    })
  }
}

export const db = new BujoDatabase()

// ─── Migration Logic ───────────────────────────────────────────────
// Finds all 'task' entries from dates before `today` and migrates them:
//  1. Old entry status → 'migrated'
//  2. New entry created for `today` with status 'task'

export async function migrateOpenTasks(today: string): Promise<number> {
  const stale = await db.entries
    .where('[date+status]')
    .below([today, 'task'])        // compound key: dates < today
    .filter((e) => e.status === 'task' && e.date < today)
    .toArray()

  if (stale.length === 0) return 0

  await db.transaction('rw', db.entries, async () => {
    for (const entry of stale) {
      // Mark old entry as migrated
      await db.entries.update(entry.id!, { status: 'migrated' as BujoStatus })
      // Create new entry for today
      await db.entries.add({
        date: today,
        status: 'task',
        body: entry.body,
        createdAt: Date.now(),
      })
    }
  })

  return stale.length
}
