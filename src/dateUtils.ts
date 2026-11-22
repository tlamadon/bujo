/** Parse a YYYY-MM-DD string as a local-time Date */
export function parseDate(iso: string): Date {
  return new Date(iso + 'T00:00:00')
}
