function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

/** Convert a Date to YYYY-MM-DD using local timezone */
export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Parse a YYYY-MM-DD string as a local-time Date */
export function parseDate(iso: string): Date {
  return new Date(iso + 'T00:00:00')
}
