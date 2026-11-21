/** Generate a sortable unique ID (date-prefix for range queries) */
export function makeId(date: string, now: number = Date.now()): string {
  return `${date}:${now}:${Math.random().toString(36).slice(2, 8)}`
}

export function makeGhostId(date: string, ref: string): string {
  return `ghost:${date}:${ref}`
}
