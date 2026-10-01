import { useEffect, useRef } from 'react'
import { randGlyph } from './glyphs'

const FONT_PX = 16
const FRAME_MS = 55
const COLOR = '#00ff9c'

// Decorative falling-glyph canvas that fills its parent. Skipped under reduced motion.
export function MatrixRain({ opacity = 0.5 }: { opacity?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const canvas = ref.current
    const parent = canvas?.parentElement
    const ctx = canvas?.getContext('2d')
    if (!canvas || !parent || !ctx) return

    let w = 0
    let h = 0
    let drops: number[] = []
    let raf = 0
    let last = 0

    const resize = () => {
      const r = parent.getBoundingClientRect()
      w = canvas.width = r.width
      h = canvas.height = r.height
      // Seed across the full height so the rain is present immediately.
      drops = Array.from({ length: Math.floor(w / FONT_PX) }, () => Math.random() * (h / FONT_PX))
    }

    const paint = (fade: boolean) => {
      ctx.fillStyle = fade ? 'rgba(3,7,5,0.16)' : 'rgba(3,7,5,1)'
      ctx.fillRect(0, 0, w, h)
      ctx.font = FONT_PX + 'px ui-monospace, monospace'
      ctx.fillStyle = COLOR
      drops.forEach((d, i) => {
        const x = i * FONT_PX
        const y = d * FONT_PX
        ctx.globalAlpha = 0.85
        ctx.fillText(randGlyph(), x, y)
        ctx.globalAlpha = 0.22
        ctx.fillText(randGlyph(), x, y - FONT_PX)
        if (y > h && Math.random() > 0.975) drops[i] = 0
        drops[i] += 0.6 + Math.random() * 0.5
      })
      ctx.globalAlpha = 1
    }

    const reset = () => {
      resize()
      // A few synchronous frames so the field is dense on first paint.
      for (let f = 0; f < 18; f++) paint(false)
    }

    reset()
    const ro = new ResizeObserver(reset)
    ro.observe(parent)

    const draw = (t: number) => {
      raf = requestAnimationFrame(draw)
      if (t - last < FRAME_MS) return
      last = t
      paint(true)
    }
    raf = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  return <canvas ref={ref} className="matrix-rain" style={{ opacity }} aria-hidden="true" />
}
