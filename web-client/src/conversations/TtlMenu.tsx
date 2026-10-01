import { useEffect, useRef, useState } from 'react'
import { TTL_OPTIONS, ttlLabel } from '../lib/expiry'
import { Icon } from '../ui/Icon'

type Props = {
  /** The current auto-delete timer in seconds, null when off. */
  ttl: number | null
  online: boolean
  /** Called with the picked timer (null: off), only when it differs from the current one. */
  onChoose: (ttlSeconds: number | null) => void
}

/** The thread bar's auto-delete button and its menu of timers. */
export function TtlMenu({ ttl, online, onChoose }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on Escape or a click outside the menu.
  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function choose(seconds: number | null) {
    setOpen(false)
    if (seconds !== ttl) onChoose(seconds)
  }

  return (
    <div className="ttl-control" ref={ref}>
      <button
        type="button"
        className={'icon-btn' + (ttl !== null ? ' ttl-on' : '')}
        title={online ? 'Auto-delete messages' : 'Auto-delete (needs a connection)'}
        aria-label={`Auto-delete messages: ${ttl === null ? 'off' : ttlLabel(ttl)}`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={!online}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="timer" size={18} />
        {ttl !== null && <span className="ttl-short">{ttlLabel(ttl, true)}</span>}
      </button>
      {open && (
        <div className="ttl-menu" role="menu" aria-label="Auto-delete new messages after">
          <p className="ttl-menu-title">auto-delete new messages</p>
          {[null, ...TTL_OPTIONS.map((o) => o.seconds)].map((seconds) => (
            <button
              key={seconds ?? 'off'}
              type="button"
              role="menuitemradio"
              aria-checked={seconds === ttl}
              className={'ttl-option' + (seconds === ttl ? ' current' : '')}
              onClick={() => choose(seconds)}
            >
              {seconds === null ? 'off' : `after ${ttlLabel(seconds)}`}
            </button>
          ))}
          <p className="ttl-menu-note">applies to messages sent from now on, for both of you.</p>
        </div>
      )}
    </div>
  )
}
