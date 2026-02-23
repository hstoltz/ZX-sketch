// Confetti particle system for goal-reached celebration

import { getCanvasTheme } from '../theme/ThemeManager.ts'

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  rotation: number
  rotationSpeed: number
  size: number
  color: string
  opacity: number
}
const PARTICLE_COUNT = 80
const GRAVITY = 0.12
const DURATION_MS = 2500

export function launchConfetti(canvas: HTMLCanvasElement): void {
  // Respect prefers-reduced-motion
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return
  }

  const overlay = document.createElement('canvas')
  overlay.width = canvas.width
  overlay.height = canvas.height
  overlay.style.cssText = `
    position: fixed; inset: 0;
    width: 100%; height: 100%;
    pointer-events: none; z-index: 999;
  `
  document.body.appendChild(overlay)
  const ctx = overlay.getContext('2d')!
  const dpr = window.devicePixelRatio || 1

  const cx = overlay.width / 2
  const particles: Particle[] = []
  const COLORS = getCanvasTheme().confettiColors

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const angle = Math.random() * Math.PI * 2
    const speed = 4 + Math.random() * 8
    particles.push({
      x: cx,
      y: overlay.height * 0.4,
      vx: Math.cos(angle) * speed * dpr,
      vy: Math.sin(angle) * speed * dpr - 4 * dpr,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.3,
      size: (3 + Math.random() * 5) * dpr,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      opacity: 1,
    })
  }

  const start = performance.now()

  function tick(now: number) {
    const elapsed = now - start
    if (elapsed > DURATION_MS) {
      overlay.remove()
      return
    }

    const fadeStart = DURATION_MS * 0.6
    const globalOpacity = elapsed > fadeStart
      ? 1 - (elapsed - fadeStart) / (DURATION_MS - fadeStart)
      : 1

    ctx.clearRect(0, 0, overlay.width, overlay.height)

    for (const p of particles) {
      p.vy += GRAVITY * dpr
      p.x += p.vx
      p.y += p.vy
      p.vx *= 0.99
      p.rotation += p.rotationSpeed
      p.opacity = globalOpacity

      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rotation)
      ctx.globalAlpha = p.opacity
      ctx.fillStyle = p.color
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2)
      ctx.restore()
    }

    requestAnimationFrame(tick)
  }

  requestAnimationFrame(tick)
}
