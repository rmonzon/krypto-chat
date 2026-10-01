import type { ReactNode } from 'react'
import { Brand } from './Brand'
import { Icon, type IconName } from './Icon'
import { MatrixRain } from './MatrixRain'

type Props = {
  icon: IconName
  iconSize: number
  rainOpacity: number
  /** Animates the core: 'bad' shakes it, 'busy' pulses it. */
  mood?: 'bad' | 'busy'
  /** The status line under the brand (announced to screen readers). */
  status: ReactNode
  children: ReactNode
}

/** Full-screen layout of the sign-in and profile setup screens. */
export function LockScreen({ icon, iconSize, rainOpacity, mood, status, children }: Props) {
  return (
    <div className="screen lock-screen">
      <MatrixRain opacity={rainOpacity} />
      <div className="lock-vapor" />
      <div className={'lock-core' + (mood ? ` ${mood}` : '')}>
        <div className="lock-badge">
          <span className="lock-ring" />
          <Icon name={icon} size={iconSize} />
        </div>
        <Brand size={1.5} />
        <div className="lock-status" role="status" aria-live="polite">
          {status}
        </div>
        {children}
      </div>
    </div>
  )
}
