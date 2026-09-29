const COLORS = ['#00ff9c', '#37d6ff', '#ff6ad5', '#ffb000', '#b388ff']

/** Stable per-user accent color, derived from the username. */
export function userColor(username: string): string {
  // FNV-1a: spreads similar names across the palette better than a plain *31 hash.
  let h = 0x811c9dc5
  for (const ch of username) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0
  return COLORS[h % COLORS.length]
}
