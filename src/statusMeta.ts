import type { BujoEntry, BujoStatus, DisplayEntry } from './db'

export const STATUS_ICONS: Record<BujoStatus, string> = {
  task: '•',
  completed: '✕',
  migrated: '>',
  scheduled: '>',
  note: '–',
  event: '○',
  dropped: '•',
  goal: '◇',
}

/** Kinds of entry offered when adding one to a log */
export const NEW_ENTRY_STATUSES: BujoStatus[] = ['task', 'event', 'note']

export const STATUS_ORDER: Record<BujoStatus, number> = {
  goal: -1,
  task: 0,
  migrated: 1,
  scheduled: 2,
  completed: 3,
  note: 4,
  event: 5,
  dropped: 6,
}

/** Ghosts (rescheduled away) sit after completed entries, before notes */
const GHOST_ORDER = 3.5

/** Open work first, then by age */
export function compareEntries(a: BujoEntry, b: BujoEntry): number {
  return STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.createdAt - b.createdAt
}

export function compareDisplayEntries(a: DisplayEntry, b: DisplayEntry): number {
  const orderA = a.isGhost ? GHOST_ORDER : STATUS_ORDER[a.entry.status]
  const orderB = b.isGhost ? GHOST_ORDER : STATUS_ORDER[b.entry.status]
  return orderA - orderB || a.entry.createdAt - b.entry.createdAt
}

export function displayEntryKey(de: DisplayEntry): string {
  return de.isGhost ? `ghost-${de.ghostDoc?._id}` : de.entry._id
}

/** The signifier for an entry (an achieved goal gets a filled diamond) */
export function entryIcon(entry: BujoEntry): string {
  if (entry.status === 'goal' && entry.goalState === 'achieved') return '◆'
  return STATUS_ICONS[entry.status] ?? '•'
}

/** CSS classes describing an entry's state, for the list item wrapping it */
export function entryClass(entry: BujoEntry): string {
  const classes = [`status-${entry.status}`]
  if (entry.goalState) classes.push(`goal-${entry.goalState}`)
  if (entry.priority) classes.push('is-priority')
  return classes.join(' ')
}
