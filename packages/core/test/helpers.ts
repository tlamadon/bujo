import PouchDB from 'pouchdb-core'
import memoryAdapter from 'pouchdb-adapter-memory'
import { createBujo, type AnyDoc, type BujoOptions } from '../src'

PouchDB.plugin(memoryAdapter)

let counter = 0

/** A fresh, empty in-memory PouchDB. */
export function newDb(): PouchDB.Database<AnyDoc> {
  counter += 1
  return new PouchDB<AnyDoc>(`bujo-test-${process.pid}-${counter}`, { adapter: 'memory' })
}

/** A clock that advances 1s per call, so createdAt ordering is deterministic. */
export function fakeClock(start = Date.UTC(2026, 10, 21, 18, 0, 0)): () => number {
  let t = start
  return () => {
    t += 1000
    return t
  }
}

export function newBujo(options: BujoOptions = {}) {
  const db = newDb()
  const bujo = createBujo(db, { now: fakeClock(), ...options })
  return { db, bujo }
}

/** Every live document in the db, by type. */
export async function dump(db: PouchDB.Database<AnyDoc>) {
  const res = await db.allDocs({ include_docs: true })
  const docs = res.rows.map((r) => r.doc as AnyDoc)
  return {
    entries: docs.filter((d) => d.type === 'entry'),
    ghosts: docs.filter((d) => d.type === 'ghost'),
    tags: docs.filter((d) => d.type === 'tag'),
  }
}
