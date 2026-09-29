import { userColor } from './colors'

export function Avatar({ username, size = 40 }: { username: string; size?: number }) {
  const color = userColor(username)
  const label = username.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '?'
  return (
    <span
      className="avatar"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        color,
        borderColor: color + '55',
        fontSize: size * 0.34,
        boxShadow: `0 0 14px ${color}22, inset 0 0 12px ${color}14`,
      }}
    >
      {label}
    </span>
  )
}
