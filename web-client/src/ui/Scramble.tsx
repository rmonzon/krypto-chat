import { useEffect, useState } from 'react'
import { randGlyph } from './glyphs'

const POOL_SIZE = 512
const TICK_MS = 70

/**
 * Decorative: renders text as shimmering random glyphs, keeping whitespace so
 * the shape of the text survives. Not encryption, just the look of it.
 */
export function Scramble({ text, className }: { text: string; className?: string }) {
  // A pool of glyphs, indexed by character position, that churns a little each tick.
  const [pool, setPool] = useState(() => Array.from({ length: POOL_SIZE }, randGlyph))

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const id = setInterval(() => {
      setPool((prev) => prev.map((g) => (Math.random() < 0.22 ? randGlyph() : g)))
    }, TICK_MS)
    return () => clearInterval(id)
  }, [])

  const shown = Array.from(text, (ch, i) => (/\s/.test(ch) ? ch : pool[i % POOL_SIZE])).join('')
  return (
    <span className={'scramble ' + (className ?? '')} aria-hidden="true">
      {shown}
    </span>
  )
}
