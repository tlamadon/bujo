/** Extract #tags from body text. Returns lowercase, deduplicated tag names. */
export function parseTags(body: string): string[] {
  const matches = body.match(/#([a-zA-Z0-9_-]+)/g)
  if (!matches) return []
  const tags = [...new Set(matches.map((m) => m.slice(1).toLowerCase()))]
  return tags
}

/** Return body text with #tags stripped out and trimmed. */
export function stripTags(body: string): string {
  return body.replace(/#[a-zA-Z0-9_-]+/g, '').replace(/\s{2,}/g, ' ').trim()
}

export const DEFAULT_TAG_COLORS = [
  '#7aa2d4', '#d4a27a', '#b39ddb', '#4caf50', '#e57373',
  '#4dd0e1', '#fff176', '#a1887f', '#90a4ae', '#f48fb1',
]

export function makeTagId(name: string): string {
  return `tag:${name.toLowerCase()}`
}
