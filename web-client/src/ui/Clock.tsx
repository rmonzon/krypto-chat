import { useEffect, useState } from 'react'
import { formatClock } from '../lib/time'

export function Clock({ className }: { className?: string }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <time className={className} dateTime={now.toISOString()}>
      {formatClock(now)}
    </time>
  )
}
