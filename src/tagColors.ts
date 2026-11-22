import { createContext } from 'react'

/**
 * Tag name → color, loaded once at the top of the app. Every entry row shows
 * tag pills; without this each of them would run its own live query.
 */
export const TagColorsContext = createContext<ReadonlyMap<string, string>>(new Map())

export const FALLBACK_TAG_COLOR = '#6b7280'

/** Black or white, whichever reads better on `hex` (WCAG relative luminance). */
export function readableTextColor(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return '#fff'
  const [r, g, b] = m.slice(1).map((part) => {
    const c = parseInt(part, 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  // Contrast against near-black text beats contrast against white above ~0.18.
  return luminance > 0.18 ? '#14141f' : '#fff'
}
