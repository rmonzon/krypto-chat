import { fnv1a } from './hash'

const COLORS = ['#00ff9c', '#37d6ff', '#ff6ad5', '#ffb000', '#b388ff']

/** Stable per-user accent color, derived from the username. */
export function userColor(username: string): string {
  return COLORS[fnv1a(username) % COLORS.length]
}
