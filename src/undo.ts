// Undo for the actions that are easy to trigger by accident and tedious to
// repair by hand: delete, reschedule, migrate.
//
// An entry and its ghosts all carry the same id tail (`${createdAt}:${uid}`),
// which survives every move. So "the state of these entries" is simply every
// document with one of those tails, and undoing is putting those documents
// back and removing whatever the action created in their place.

import { idTail, localDb, type AnyDoc, type BujoEntry } from './db'

export type Snapshot = { tails: string[]; docs: AnyDoc[] }

function belongsTo(doc: AnyDoc, tails: string[]): boolean {
  if (doc.type === 'entry') return tails.includes(idTail(doc._id))
  if (doc.type === 'ghost') return tails.some((tail) => doc._id.endsWith(`:${tail}`))
  return false
}

async function familyOf(tails: string[]): Promise<AnyDoc[]> {
  const res = await localDb.allDocs({ include_docs: true })
  return res.rows.flatMap((row) => (row.doc && belongsTo(row.doc, tails) ? [row.doc as AnyDoc] : []))
}

/** Capture entries (and their ghosts) as they are stored right now. */
export async function takeSnapshot(entries: BujoEntry[]): Promise<Snapshot> {
  const tails = entries.map((e) => idTail(e._id))
  return { tails, docs: await familyOf(tails) }
}

/** Put the captured documents back, and remove what replaced them. */
export async function restoreSnapshot(snapshot: Snapshot): Promise<void> {
  const current = await familyOf(snapshot.tails)
  const currentRev = new Map(current.map((d) => [d._id, d._rev]))
  const wanted = new Set(snapshot.docs.map((d) => d._id))

  const ops: (AnyDoc & { _deleted?: boolean })[] = []
  for (const doc of current) {
    if (!wanted.has(doc._id)) ops.push({ ...doc, _deleted: true })
  }
  for (const doc of snapshot.docs) {
    // Write over the live revision if there is one; a deleted document is
    // recreated by writing it without a revision.
    const restored = { ...doc, _rev: currentRev.get(doc._id) }
    if (!restored._rev) delete restored._rev
    ops.push(restored)
  }
  if (ops.length === 0) return

  const results = await localDb.bulkDocs(ops)
  if (results.some((r) => 'error' in r && r.error)) {
    throw new Error('Could not undo: the entry changed in the meantime')
  }
}
