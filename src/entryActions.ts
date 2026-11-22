import {
  completeEntry,
  deleteEntry,
  getChildren,
  getOverdueTasks,
  isClosed,
  migrateOpenTasks,
  reopenEntry,
  rescheduleEntry,
  type BujoEntry,
} from './db'
import { formatDateValue } from './format'
import { showError, showToast } from './toast'
import { restoreSnapshot, takeSnapshot } from './undo'

/**
 * What a tap on an entry's signifier does: done ↔ not done, nothing else.
 * Changing what kind of entry it is lives in the detail panel, where it
 * cannot happen by accident.
 */
export async function toggleEntryDone(entry: BujoEntry): Promise<void> {
  try {
    await (isClosed(entry) ? reopenEntry(entry) : completeEntry(entry))
  } catch (err) {
    showError(err)
  }
}

export async function deleteWithUndo(entry: BujoEntry): Promise<void> {
  // Deleting an epic sets its subtasks loose: undo has to put those links back too.
  const snapshot = await takeSnapshot([entry, ...(await getChildren(entry))])
  await deleteEntry(entry)
  showToast('Entry deleted', { label: 'Undo', run: () => restoreSnapshot(snapshot) })
}

export async function rescheduleWithUndo(entry: BujoEntry, date: string): Promise<void> {
  const snapshot = await takeSnapshot([entry])
  await rescheduleEntry(entry, date)
  showToast(`Moved to ${formatDateValue(date)}`, { label: 'Undo', run: () => restoreSnapshot(snapshot) })
}

export async function migrateWithUndo(today: string): Promise<void> {
  const snapshot = await takeSnapshot(await getOverdueTasks(today))
  const moved = await migrateOpenTasks(today)
  if (moved.length === 0) {
    showToast('No open tasks to carry forward')
    return
  }
  showToast(`Carried ${moved.length} ${moved.length === 1 ? 'task' : 'tasks'} forward`, {
    label: 'Undo',
    run: () => restoreSnapshot(snapshot),
  })
}
