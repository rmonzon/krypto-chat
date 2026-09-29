import { useMemo } from 'react'

const GRID = 7

/**
 * Decorative 7×7 mirrored pattern derived from seed (e.g. a user id).
 * Stable per seed, so it works as a visual signature. Not a key fingerprint.
 */
export function Identicon({ seed, size = 96 }: { seed: string; size?: number }) {
  const cells = useMemo(() => {
    const random = mulberry32(fnv1a(seed))
    const on: { x: number; y: number }[] = []
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < Math.ceil(GRID / 2); x++) {
        if (random() < 0.5) {
          on.push({ x, y })
          if (x < GRID - 1 - x) on.push({ x: GRID - 1 - x, y })
        }
      }
    }
    return on
  }, [seed])
  const u = size / GRID

  return (
    <svg width={size} height={size} className="identicon" aria-hidden="true">
      {cells.map(({ x, y }) => (
        <rect key={`${x}-${y}`} x={x * u + 1} y={y * u + 1} width={u - 2} height={u - 2} rx="1" />
      ))}
    </svg>
  )
}

function fnv1a(text: string) {
  let h = 0x811c9dc5
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0
  return h
}

/** Small seeded PRNG: uniform floats in [0, 1). */
function mulberry32(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
