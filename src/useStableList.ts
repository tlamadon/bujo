import { useMemo, useState } from 'react'

interface Options<T> {
  id: (item: T) => string
  /** The order a freshly opened list is in. */
  compare: (a: T, b: T) => number
  /** Which items belong in the list. An item already shown stays until it is gone. */
  include?: (item: T) => boolean
  /** The list starts over (re-sorted, re-filtered) when this changes. */
  resetKey: string
}

/**
 * Sort and filter a list once, then hold it still.
 *
 * Lists here are ordered by status, so ticking a task off would move it — and
 * slide another entry under the finger that is about to tap again. Instead a
 * row keeps its place for as long as the list is on screen: new items slot in
 * where the sort puts them, and nothing already shown moves or disappears
 * until the user looks at something else (`resetKey`) or comes back.
 */
export function useStableList<T>(items: T[] | undefined, options: Options<T>): T[] | undefined {
  const { id, compare, include, resetKey } = options
  const [shown, setShown] = useState<{ key: string; ids: string[] }>({ key: resetKey, ids: [] })
  const previous = shown.key === resetKey ? shown.ids : NONE

  const ordered = useMemo(() => {
    if (!items) return undefined
    const byId = new Map(items.map((item) => [id(item), item]))
    const result: T[] = previous.flatMap((key) => (byId.has(key) ? [byId.get(key) as T] : []))
    const placed = new Set(result.map(id))

    // Walk the fully sorted list; a new item goes right after its nearest
    // already-placed predecessor.
    let anchor = -1
    for (const item of [...items].sort(compare)) {
      if (placed.has(id(item))) {
        anchor = result.indexOf(item)
      } else if (!include || include(item)) {
        result.splice(++anchor, 0, item)
      }
    }
    return result
    // `id`, `compare` and `include` are expected to be stable in what they do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, previous])

  // Remember what is on screen (adjusting state while rendering, so the
  // remembered order is never a frame behind).
  if (ordered) {
    const ids = ordered.map(id)
    if (shown.key !== resetKey || !sameIds(ids, shown.ids)) setShown({ key: resetKey, ids })
  }

  return ordered
}

const NONE: string[] = []

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i])
}
