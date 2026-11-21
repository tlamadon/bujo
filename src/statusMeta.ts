import type { BujoEntry, BujoStatus } from './db'

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

/** Statuses offered when adding an entry to a log */
export const NEW_ENTRY_STATUSES: BujoStatus[] = ['task', 'completed', 'migrated', 'scheduled', 'note', 'event']

/** Statuses a click on the signifier cycles through */
export const STATUS_CYCLE: BujoStatus[] = ['task', 'completed', 'note', 'event']

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
