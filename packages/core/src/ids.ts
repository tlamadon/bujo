// Entry ids are `${date}:${createdAtMs}:${uid}`.
//
// The date prefix makes allDocs range queries by date cheap. Everything after
// it — the "tail" — never changes: rescheduling an entry only swaps the
// prefix. The uid at the very end is the entry's short, human-typable ref.

const UID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'
const UID_LENGTH = 6

/** A random 6-character base36 uid: the stable short ref of an entry. */
export function makeUid(): string {
  let uid = ''
  for (let i = 0; i < UID_LENGTH; i++) {
    uid += UID_ALPHABET[Math.floor(Math.random() * UID_ALPHABET.length)]
  }
  return uid
}

/** Generate a sortable unique ID (date-prefix for range queries) */
export function makeId(date: string, now: number = Date.now()): string {
  return `${date}:${now}:${makeUid()}`
}

/** The part of an entry id that survives reschedules: `${createdAtMs}:${uid}`. */
export function idTail(id: string): string {
  const i = id.indexOf(':')
  return i < 0 ? id : id.slice(i + 1)
}

/** The short ref of an entry: the uid at the end of its id. */
export function refOf(id: string): string {
  return id.slice(id.lastIndexOf(':') + 1)
}

/** The id an entry has once it is moved to `date`. */
export function withDate(id: string, date: string): string {
  return `${date}:${idTail(id)}`
}

/** One ghost per (day, entry): `ghost:${date}:${entry tail}`. */
export function makeGhostId(date: string, entryId: string): string {
  return `ghost:${date}:${idTail(entryId)}`
}
