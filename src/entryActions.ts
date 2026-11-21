import { completeEntry, reopenEntry, updateEntry, type BujoEntry } from './db'
import { STATUS_CYCLE } from './statusMeta'

/** What a click on an entry's signifier does */
export async function cycleEntryStatus(entry: BujoEntry): Promise<void> {
  if (entry.status === 'goal') {
    // Goals toggle between open and achieved
    await (entry.goalState ? reopenEntry(entry) : completeEntry(entry))
    return
  }
  const idx = STATUS_CYCLE.indexOf(entry.status)
  const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length]
  await updateEntry(entry, { status: next })
}
