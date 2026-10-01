import type { CSSProperties } from 'react'

// Stroke icons on a 24×24 grid. Multi-part icons separate subpaths with " M".
const ICONS = {
  lock: 'M6 10V7a6 6 0 1 1 12 0v3 M5 10h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z M12 14v3',
  unlock: 'M7 10V7a5 5 0 0 1 9.6-2 M5 10h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z M12 14v3',
  key: 'M14 7a4 4 0 1 0-3.8 5.3L4 18.5V21h3l1-1h2l1-1v-2l1.2-1.2A4 4 0 0 0 14 7Z M16.5 9.5h.01',
  send: 'M4 12 20 4l-6 16-2.5-6.5L4 12Z',
  shield: 'M12 3l8 3v6c0 5-3.5 7.7-8 9-4.5-1.3-8-4-8-9V6l8-3Z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z M21 21l-4.3-4.3',
  plus: 'M12 5v14 M5 12h14',
  back: 'M15 19l-7-7 7-7',
  dots: 'M5 12h.01 M12 12h.01 M19 12h.01',
  check: 'M5 13l4 4L19 7',
  check2: 'M1.5 13l4 4L11 9 M8 13l4 4 8.5-10',
  pin: 'M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6Z M12 15v5',
  fingerprint:
    'M12 11a2 2 0 0 0-2 2c0 3 .5 4.5 1 6 M12 7a6 6 0 0 0-6 6c0 2 .3 3.4.8 4.6 M12 3a10 10 0 0 0-9.5 7 M16 13a4 4 0 0 0-4-4 M20 8a10 10 0 0 0-2-3 M18 13c0 4-1 6-1.5 7.5',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M4 21a8 8 0 0 1 16 0',
  cpu: 'M9 3v2 M15 3v2 M9 19v2 M15 19v2 M3 9h2 M3 15h2 M19 9h2 M19 15h2 M6 6h12v12H6z M9 9h6v6H9z',
  copy: 'M9 9h11v11H9z M5 15H4V4h11v1',
  refresh: 'M3 12a9 9 0 0 1 15-6.7L21 8 M21 4v4h-4 M21 12a9 9 0 0 1-15 6.7L3 16 M3 20v-4h4',
  chevron: 'M9 6l6 6-6 6',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  alert: 'M12 3 2 20h20L12 3Z M12 10v4 M12 17h.01',
  signal: 'M4 20v-3 M9 20v-7 M14 20v-11 M19 20V5',
  userPlus: 'M10 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M3 21a7 7 0 0 1 14 0 M19 8v6 M16 11h6',
  qr: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h2v2h-2z M18 18h2v2h-2z M18 14h2 M14 18v2',
  ticket: 'M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4V7Z M14 7v2 M14 11v2 M14 15v2',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M12 7v5l3 2',
  timer: 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z M12 9v4l2.5 2 M10 2h4 M12 2v3',
  mail: 'M4 6h16v12H4z M4 7l8 6 8-6',
  logout: 'M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4 M10 17l-5-5 5-5 M5 12h11',
}

export type IconName = keyof typeof ICONS

type IconProps = {
  name: IconName
  size?: number
  stroke?: number
  className?: string
  style?: CSSProperties
}

export function Icon({ name, size = 18, stroke = 1.7, className = '', style }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={'icon ' + className}
      style={style}
      aria-hidden="true"
    >
      {ICONS[name].split(' M').map((seg, i) => (
        <path key={i} d={i === 0 ? seg : 'M' + seg} />
      ))}
    </svg>
  )
}
