import type { BujoEntry } from './types'

export type BujoErrorCode = 'not_found' | 'ambiguous' | 'invalid'

/** Base class for errors a caller is expected to handle (bad input, no match…). */
export class BujoError extends Error {
  readonly code: BujoErrorCode

  constructor(code: BujoErrorCode, message: string) {
    super(message)
    this.name = 'BujoError'
    this.code = code
  }
}

export class NotFoundError extends BujoError {
  constructor(message: string) {
    super('not_found', message)
    this.name = 'NotFoundError'
  }
}

/** A reference matched more than one entry. `candidates` lists them. */
export class AmbiguousError extends BujoError {
  readonly candidates: BujoEntry[]

  constructor(message: string, candidates: BujoEntry[]) {
    super('ambiguous', message)
    this.name = 'AmbiguousError'
    this.candidates = candidates
  }
}

export class InvalidError extends BujoError {
  constructor(message: string) {
    super('invalid', message)
    this.name = 'InvalidError'
  }
}

/** Whether a rejected db call (or a bulkDocs row) is a revision conflict. */
export function isConflict(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { status?: unknown; name?: unknown; error?: unknown }
  return e.status === 409 || e.name === 'conflict' || e.error === 'conflict'
}

/** Whether a rejected db call means "no such document". */
export function isMissing(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { status?: unknown; name?: unknown; error?: unknown }
  return e.status === 404 || e.name === 'not_found' || e.error === 'not_found'
}
