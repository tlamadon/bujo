// Subtasks. An entry may name another as its `parent`; an entry with subtasks
// is an "epic". Nothing else is stored: which entries are epics, and how far
// along they are, is worked out from the entries themselves.

import { idTail } from './ids'
import type { BujoEntry } from './types'

/** Something that gets done (or dropped), as opposed to a note or an event. */
export function isTaskLike(entry: BujoEntry): boolean {
  return entry.status !== 'note' && entry.status !== 'event'
}

export interface Progress {
  /** Subtasks completed */
  done: number
  /** Subtasks that count: tasks, open or completed. Dropped ones, notes and events do not. */
  total: number
}

export interface FamilyIndex {
  /** The entry this one is a subtask of, if that entry still exists */
  parentOf(entry: BujoEntry): BujoEntry | undefined
  /** Subtasks, oldest first */
  childrenOf(entry: BujoEntry): BujoEntry[]
  /** Progress through the subtasks; null for an entry that has none */
  progressOf(entry: BujoEntry): Progress | null
}

/** Index parent/subtask links across `entries` (all of them, for complete answers). */
export function familyIndex(entries: BujoEntry[]): FamilyIndex {
  const byTail = new Map<string, BujoEntry>()
  const children = new Map<string, BujoEntry[]>()
  for (const entry of entries) byTail.set(idTail(entry._id), entry)
  for (const entry of entries) {
    if (!entry.parent || !byTail.has(entry.parent)) continue
    const siblings = children.get(entry.parent)
    if (siblings) siblings.push(entry)
    else children.set(entry.parent, [entry])
  }
  for (const list of children.values()) list.sort((a, b) => a.createdAt - b.createdAt)

  const childrenOf = (entry: BujoEntry) => children.get(idTail(entry._id)) ?? []
  return {
    parentOf: (entry) => (entry.parent ? byTail.get(entry.parent) : undefined),
    childrenOf,
    progressOf(entry) {
      const subtasks = childrenOf(entry)
      if (subtasks.length === 0) return null
      const done = subtasks.filter((e) => e.status === 'completed').length
      return { done, total: done + subtasks.filter((e) => e.status === 'task').length }
    },
  }
}

/** An index that knows of no links: for callers with nothing to look up. */
export const NO_FAMILIES: FamilyIndex = familyIndex([])
