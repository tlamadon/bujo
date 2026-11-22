// Small line icons, drawn on a 20×20 grid and colored by `currentColor`.

import type { ReactNode } from 'react'

function Icon({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

export const ChevronLeft = () => (
  <Icon>
    <path d="M12.5 4.5 7 10l5.5 5.5" />
  </Icon>
)

export const ChevronRight = () => (
  <Icon>
    <path d="M7.5 4.5 13 10l-5.5 5.5" />
  </Icon>
)

export const Plus = () => (
  <Icon size={16}>
    <path d="M10 4v12M4 10h12" />
  </Icon>
)

export const Close = () => (
  <Icon>
    <path d="m5 5 10 10M15 5 5 15" />
  </Icon>
)

export const More = () => (
  <Icon>
    <circle cx="4.5" cy="10" r="1" fill="currentColor" />
    <circle cx="10" cy="10" r="1" fill="currentColor" />
    <circle cx="15.5" cy="10" r="1" fill="currentColor" />
  </Icon>
)

/** One day: a single page with a bullet */
export const DayIcon = () => (
  <Icon>
    <rect x="4" y="3" width="12" height="14" rx="2" />
    <path d="M7.5 8h5M7.5 12h3" />
  </Icon>
)

/** A week: seven columns, abbreviated */
export const WeekIcon = () => (
  <Icon>
    <rect x="3" y="4" width="14" height="12" rx="2" />
    <path d="M7.7 4v12M12.3 4v12" />
  </Icon>
)

/** A month: a calendar grid */
export const MonthIcon = () => (
  <Icon>
    <rect x="3" y="4" width="14" height="13" rx="2" />
    <path d="M3 8.5h14M7 2.5v3M13 2.5v3" />
  </Icon>
)

/** The future log: forward */
export const FutureIcon = () => (
  <Icon>
    <path d="M4 10h11M11 5.5l4.5 4.5-4.5 4.5" />
  </Icon>
)

export const TagIcon = () => (
  <Icon>
    <path d="M8 3 6.5 17M13.5 3 12 17M4 7.5h13M3 12.5h13" />
  </Icon>
)

/** An epic: a task with subtasks */
export const Bolt = () => (
  <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" focusable="false">
    <path d="M11.5 1 3.5 11.5H9L7.5 19l9-11H11z" />
  </svg>
)
