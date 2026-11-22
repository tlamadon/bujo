import { useEffect, useState } from 'react'
import { todayIn } from '@bujo/core'

/**
 * Today's date (local timezone), kept current: an installed app is routinely
 * left open overnight and resumed the next morning.
 */
export function useToday(): string {
  const [today, setToday] = useState(() => todayIn())

  useEffect(() => {
    const check = () => setToday(todayIn())
    const interval = window.setInterval(check, 60_000)
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
    }
  }, [])

  return today
}
